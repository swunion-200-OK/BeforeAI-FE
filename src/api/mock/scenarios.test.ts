// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { x25519 } from '@noble/curves/ed25519.js'
import { cryptoService } from '../../crypto/cryptoService'
import { signingService } from '../../crypto/signingService'
import { deviceStore } from '../../crypto/deviceStore'
import { bytesToBase64 } from '../../crypto/encoding'
import { canonicalize, hashService, toHashTarget } from '../../crypto/hashService'
import {
  signAndSubmitApproval,
  submitWithSelfApproval,
  verifyIntegrity,
  IntegrityError,
} from '../../features/approvals/approvalFlow'
import { setAccessToken, setTransport } from '../client'
import {
  adminApi,
  approvalsApi,
  auditApi,
  authApi,
  dashboardApi,
  editorApi,
  forbiddenApi,
  meApi,
  projectsApi,
  requestsApi,
} from '../endpoints'
import type { Me, RequestStatus, Task } from '../types'
import { devControls, initMock, mockFetch } from './index'
import { toTask } from './analysis'
import { findForbiddenReason, hitsForbiddenTarget, requiredRules } from './policy'
import { buildSeed } from './seed'
import { db, mockConfig } from './store'
import { WEBSHELL_PUBLIC_KEY, contentFitsType, isAwaitingExecution, openEnvelope, requestExecution, scheduleExecution, verifyExecution } from './webshell'

class MemoryStorage {
  private map = new Map<string, string>()
  getItem = (key: string) => this.map.get(key) ?? null
  setItem = (key: string, value: string) => void this.map.set(key, value)
  removeItem = (key: string) => void this.map.delete(key)
}

function asUser(userId: string, network: 'INTERNAL' | 'EXTERNAL' = 'INTERNAL') {
  devControls.setNetwork(network)
  setAccessToken(devControls.switchUser(userId))
}

async function me(): Promise<Me> {
  return meApi.get()
}

async function waitForStatus(requestId: string, predicate: (status: RequestStatus) => boolean) {
  await vi.waitFor(
    async () => {
      const detail = await requestsApi.get(requestId)
      expect(predicate(detail.status), `현재 상태 ${detail.status}`).toBe(true)
    },
    { timeout: 4000, interval: 10 },
  )
  return requestsApi.get(requestId)
}

const notAnalyzing = (status: RequestStatus) => status !== 'ANALYZING'

const storedRequest = (id: string) => db().requests.find((r) => r.id === id)!

async function approveAs(userId: string, requestId: string, taskIds: string[]) {
  asUser(userId)
  const approver = await me()
  return signAndSubmitApproval({ me: approver, context: await approvalsApi.context(requestId), taskIds })
}

const reviewedPlan = async (requestId: string) => {
  const detail = await requestsApi.get(requestId)
  return { projectId: detail.projectId, tasks: detail.plan!.tasks }
}

async function registerKeyFor(userId: string) {
  asUser(userId)
  const { publicKey } = signingService.generateDeviceKey(userId)
  const key = await meApi.submitSigningKey(publicKey)
  deviceStore.update(userId, { keyId: key.keyId, pinnedWebshellKey: await meApi.webshellPublicKey() })
  asUser('u-admin')
  await adminApi.registerKey(key.keyId)
  asUser(userId)
  return (await meApi.signingKeys()).items.find((item) => item.keyId === key.keyId)!
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
  mockConfig.latencyMs = 0
  mockConfig.analysisMs = 1
  mockConfig.execStepMs = 1
  mockConfig.webshellRetryMs = 1
  mockConfig.webshellReachable = true
  setTransport(mockFetch)
  initMock()
  deviceStore.clear()
  buildSeed()
  asUser('u-01')
})

afterEach(() => {
  setAccessToken(null)
  vi.unstubAllGlobals()
})

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code })
}

describe('crypto', () => {
  it('JCS는 키를 정렬하고 값은 그대로 둔다', () => {
    expect(canonicalize({ b: 1, a: [true, null, 'x'], c: { z: 1, y: 2 } })).toBe(
      '{"a":[true,null,"x"],"b":1,"c":{"y":2,"z":1}}',
    )
  })

  it('Plan 내용이 바뀌면 해시가 바뀌고, 작업 상태만 바뀌면 그대로다', async () => {
    const { plan } = await requestsApi.get('r-main')
    const hash = hashService.computePlanHash(plan!)
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    const statusOnly = { ...plan!, tasks: plan!.tasks.map((t) => ({ ...t, status: 'RUNNING' as const })) }
    expect(hashService.computePlanHash(statusOnly)).toBe(hash)
    const edited = { ...plan!, tasks: plan!.tasks.map((t) => ({ ...t, target: 'production' })) }
    expect(hashService.computePlanHash(edited)).not.toBe(hash)
  })

  it('기기에서 만든 키로 서명하고 검증한다', () => {
    const { publicKey } = signingService.generateDeviceKey('u-x')
    const payload = {
      planHash: 'sha256:a',
      requestId: 'r',
      planId: 'p',
      taskIds: ['t-1'],
      approverId: 'u-x',
      keyId: 'k',
      issuedAt: 'now',
      nonce: 'n',
      network: 'INTERNAL' as const,
    }
    const signed = signingService.sign('u-x', payload)
    expect(signingService.verifyApproval(signed, publicKey)).toBe(true)
    expect(signingService.verifyApproval({ ...signed, payload: { ...payload, taskIds: ['t-2'] } }, publicKey)).toBe(false)
  })
})

describe('시연 시나리오', () => {
  it('1~4: 요청 → 제출과 본인 승인 → 외부망 막힘 → 내부망 승인 → 실행 완료', async () => {
    // 1. 홍길동(내부망): 작업 요청 → Plan 카드 2개 → 제출, t-1은 본인 승인
    const { id } = await requestsApi.create({
      projectId: 'prj-auth',
      prompt: '로그인 실패 시 에러 메시지를 바꾸고 스테이징에 배포해줘',
    })
    const reviewing = await waitForStatus(id, notAnalyzing)
    expect(reviewing.status).toBe('REVIEWING')
    expect(reviewing.plan!.tasks.map((t) => [t.type, t.risk])).toEqual([
      ['CODE_FEATURE', 'MEDIUM'],
      ['DEPLOY', 'HIGH'],
    ])
    const hong = await me()
    const outcome = await submitWithSelfApproval(hong, id, await reviewedPlan(id))
    expect(outcome.selfApprovalError).toBeNull()
    expect(outcome.selfApprovedTaskIds).toEqual(['t-1'])
    expect(outcome.executionRequested).toBe(false)

    // 2. 김담당(외부망): t-2 배포는 내부망 승인 필요
    asUser('u-07', 'EXTERNAL')
    const external = await approvalsApi.context(id)
    expect(external.approvableTaskIds).toEqual([])
    expect(external.blockedTaskIds).toEqual(['t-2'])
    expect(external.blockedReason).toBe('INTERNAL_NETWORK_ONLY')
    const pendingExternal = await approvalsApi.pending()
    expect(pendingExternal.items.find((i) => i.requestId === id)?.blockedReason).toBe('INTERNAL_NETWORK_ONLY')

    // 3. 김담당(내부망): 해시·화면 내용 확인 → 서명 → 실행 요청
    asUser('u-07')
    const kim = await me()
    const internal = await approvalsApi.context(id)
    expect(internal.approvableTaskIds).toEqual(['t-2'])
    expect(verifyIntegrity(internal, kim.id).ok).toBe(true)
    const steps: string[] = []
    const result = await signAndSubmitApproval({
      me: kim,
      context: internal,
      taskIds: ['t-2'],
      onStep: (step) => void steps.push(step),
    })
    expect(steps).toEqual(['hash', 'sign', 'encrypt', 'submit'])
    expect(result.executionRequested).toBe(true)
    expect(result.status).toBe('RUNNING')

    // 4. 홍길동: 실시간 로그로 끝까지 확인
    asUser('u-01')
    const lines: string[] = []
    await requestsApi.streamLogs(id, (line) => lines.push(line.text), new AbortController().signal)
    expect(lines.at(0)).toContain('승인 서명 검증 통과')
    expect(lines.at(-1)).toContain('세션을 닫습니다')
    const finished = await requestsApi.get(id)
    expect(finished.status).toBe('COMPLETED')
    expect(finished.plan!.tasks.every((t) => t.status === 'SUCCEEDED')).toBe(true)
  })

  it('시드의 r-main도 김담당 서명으로 실행까지 간다', async () => {
    asUser('u-07')
    const kim = await me()
    const context = await approvalsApi.context('r-main')
    const result = await signAndSubmitApproval({ me: kim, context, taskIds: ['t-2'] })
    expect(result.executionRequested).toBe(true)
    expect(result.status).toBe('RUNNING')
  })

  it('외부망은 코드 수정(낮음·중간)만 승인할 수 있다', async () => {
    asUser('u-07', 'EXTERNAL')
    const kim = await me()
    const context = await approvalsApi.context('r-external')
    expect(context.approvableTaskIds).toEqual(['t-1'])
    expect(context.blockedTaskIds).toEqual(['t-2'])
    await signAndSubmitApproval({ me: kim, context, taskIds: ['t-1'] })
    await expectError(signAndSubmitApproval({ me: kim, context, taskIds: ['t-2'] }), 'INTERNAL_NETWORK_ONLY')
    // AI가 높음으로 올린 코드 수정도 외부망에서는 막힌다.
    const high = await approvalsApi.context('r-high-code')
    expect(high.blockedTaskIds).toEqual(['t-1'])
  })

  it('5: 승인 대기 중 Plan을 고치면 재승인필요, 바뀐 작업 표시, 옛 서명 무효', async () => {
    const before = await requestsApi.get('r-main')
    const hashBefore = before.plan!.planHash
    await requestsApi.patchPlan('r-main', {
      basePlanId: before.currentPlanId!,
      changes: [{ op: 'UPDATE', taskId: 't-1', instruction: '메시지를 한국어와 영어 둘 다 보여줘' }],
    })
    const after = await waitForStatus('r-main', notAnalyzing)
    expect(after.status).toBe('REAPPROVAL_REQUIRED')
    expect(after.changedTaskIds).toEqual(['t-1'])
    expect(after.approvalStatus.flatMap((s) => s.requirements.flatMap((r) => r.approvedBy))).toEqual([])
    const hong = await me()
    const outcome = await submitWithSelfApproval(hong, 'r-main', await reviewedPlan('r-main'))
    expect(outcome.submit.planHash).not.toBe(hashBefore)
    expect(outcome.selfApprovedTaskIds).toEqual(['t-1'])
  })

  it('5-1: 현재 Plan이 아닌 곳에 서명하면 PLAN_HASH_MISMATCH', async () => {
    asUser('u-07')
    const kim = await me()
    const stale = await approvalsApi.context('r-main')
    asUser('u-01')
    const { plan } = await requestsApi.get('r-main')
    await requestsApi.patchPlan('r-main', {
      basePlanId: plan!.id,
      changes: [{ op: 'UPDATE', taskId: 't-1', instruction: '문구 수정' }],
    })
    await waitForStatus('r-main', notAnalyzing)
    await submitWithSelfApproval(await me(), 'r-main', await reviewedPlan('r-main'))
    asUser('u-07')
    await expectError(signAndSubmitApproval({ me: kim, context: stale, taskIds: ['t-2'] }), 'PLAN_HASH_MISMATCH')
  })

  it('6: 금지 작업은 차단되고, 금지만 남으면 제출이 막힌다', async () => {
    const { id } = await requestsApi.create({ projectId: 'prj-auth', prompt: '운영 DB에 컬럼을 추가해줘' })
    const detail = await waitForStatus(id, notAnalyzing)
    expect(detail.plan!.tasks[0]).toMatchObject({ risk: 'FORBIDDEN', status: 'BLOCKED' })
    expect(detail.plan!.tasks[0].forbiddenReason).toBeTruthy()
    await expectError(requestsApi.submit(id), 'FORBIDDEN_TASK')

    // 금지 작업이 섞여 있으면 나머지는 제출되고 실행까지 간다.
    const hong = await me()
    const outcome = await submitWithSelfApproval(hong, 'r-forbidden', await reviewedPlan('r-forbidden'))
    expect(outcome.selfApprovedTaskIds).toEqual(['t-2'])
    expect(outcome.executionRequested).toBe(true)
  })

  it('6-2: 웹쉘 정책의 금지 규칙에 걸리면 검증실패가 되고 실패 항목이 남는다', async () => {
    asUser('u-admin')
    await forbiddenApi.addRule({ departmentId: 'd-backend', taskType: 'DEPLOY', target: 'staging', reason: '동결 기간' })
    asUser('u-07')
    const kim = await me()
    const context = await approvalsApi.context('r-main')
    const result = await signAndSubmitApproval({ me: kim, context, taskIds: ['t-2'] })
    expect(result.status).toBe('VERIFICATION_FAILED')
    const detail = await requestsApi.get('r-main')
    expect(detail.failedChecks).toContain('FORBIDDEN_TASK')
    expect(detail.plan!.tasks.find((t) => t.id === 't-2')?.status).toBe('FAILED')
  })

  it('7: 박CTO는 전사 대시보드와 외부망 승인 기록을 본다', async () => {
    asUser('u-admin')
    const dashboard = await dashboardApi.get('COMPANY')
    expect(dashboard.requestCount).toBeGreaterThan(10)
    expect(dashboard.byDepartment).toHaveLength(2)
    const logs = await auditApi.list({ network: 'EXTERNAL', action: 'APPROVAL_SUBMITTED' })
    expect(logs.items.length).toBeGreaterThan(0)
    expect(logs.items.every((l) => l.network === 'EXTERNAL')).toBe(true)
  })
})

describe('규칙', () => {
  it('상태 배지를 전부 시연할 수 있게 시드에 16개 상태가 다 있다', async () => {
    asUser('u-admin')
    const { items } = await requestsApi.list({ limit: 100 })
    const statuses = new Set(items.map((r) => r.status))
    expect(statuses.size).toBe(16)
  })

  it('외부망은 내부 전용 API를 403으로 막고 모든 응답에 X-Network를 준다', async () => {
    asUser('u-01', 'EXTERNAL')
    await expectError(requestsApi.create({ projectId: 'prj-auth', prompt: '테스트 추가' }), 'INTERNAL_NETWORK_ONLY')
    await expectError(editorApi.files('prj-auth'), 'INTERNAL_NETWORK_ONLY')
    await expectError(projectsApi.updateSpec('prj-auth', 'x'), 'INTERNAL_NETWORK_ONLY')
    const response = await mockFetch('/api/v1/approval-matrix', {
      headers: { Authorization: `Bearer ${devControls.switchUser('u-01')}` },
    })
    expect(response.headers.get('X-Network')).toBe('EXTERNAL')
    // 요청 취소·킬 스위치·대시보드·감사 로그는 외부망에서도 된다.
    await requestsApi.cancel('r-reviewing')
    await requestsApi.kill('r-running', '멈춤')
    await dashboardApi.get('ME')
    await auditApi.list({})
  })

  it('외부망 로그인은 OTP를 거쳐야 토큰이 나온다', async () => {
    setAccessToken(null)
    devControls.setNetwork('EXTERNAL')
    const login = await authApi.login('E1107', 'demo1234!')
    expect(login.otpRequired).toBe(true)
    expect(login.accessToken).toBeUndefined()
    await expectError(authApi.verifyOtp(login.tempToken!, '000000'), 'VALIDATION_ERROR')
    const token = await authApi.verifyOtp(login.tempToken!, '123456')
    expect(token.accessToken).toBeTruthy()
  })

  it('담당자를 2명 미만으로 줄이면 막고, 빠진 담당자가 필요한 요청은 재승인필요가 된다', async () => {
    asUser('u-mgr-be')
    await expectError(projectsApi.updateOwners('prj-auth', ['u-07']), 'OWNER_MINIMUM')
    await projectsApi.updateOwners('prj-auth', ['u-07', 'u-mgr-be'])
    const detail = await requestsApi.get('r-main')
    expect(detail.status).toBe('REAPPROVAL_REQUIRED')
    expect(detail.changedTaskIds).toEqual(['t-2'])
  })

  it('중규모·대규모 프리셋은 필요한 승인 인원을 늘린다', async () => {
    asUser('u-admin')
    await adminApi.applyPreset('MEDIUM')
    const { id } = await requestsApi.create({ projectId: 'prj-auth', prompt: '스테이징에 배포해줘' })
    const detail = await waitForStatus(id, notAnalyzing)
    expect(detail.plan!.tasks[0].requiredApprovers.map((r) => r.rule)).toEqual(['PROJECT_OWNER', 'DEPT_MANAGER'])

    await adminApi.applyPreset('LARGE')
    const large = await requestsApi.create({ projectId: 'prj-auth', prompt: '로그인 테스트를 보강해줘' })
    const low = await waitForStatus(large.id, notAnalyzing)
    expect(low.plan!.tasks[0].requiredApprovers.map((r) => r.rule)).toEqual(['SAME_DEPT_OTHER'])
    // 대규모에서 낮음·중간은 요청자 외 같은 부서 1인이라 본인 승인이 없다.
    const outcome = await submitWithSelfApproval(await me(), large.id, await reviewedPlan(large.id))
    expect(outcome.selfApprovedTaskIds).toEqual([])
  })

  it('분석 재시도는 3회까지다', async () => {
    const { id } = await requestsApi.create({ projectId: 'prj-auth', prompt: '테스트 추가해줘 #분석실패' })
    await waitForStatus(id, (s) => s === 'ANALYSIS_FAILED')
    await requestsApi.retryAnalysis(id)
    await waitForStatus(id, (s) => s === 'ANALYSIS_FAILED')
    await requestsApi.retryAnalysis(id)
    const detail = await waitForStatus(id, (s) => s === 'ANALYSIS_FAILED')
    expect(detail.analysisAttempts).toBe(3)
    await expectError(requestsApi.retryAnalysis(id), 'RETRY_LIMIT')
  })

  it('확인 질문에 답하면 Plan이 만들어진다', async () => {
    const before = await requestsApi.get('r-clarify')
    expect(before.clarification).toBeTruthy()
    await requestsApi.patchPlan('r-clarify', { answer: '로그인 테스트를 보강해줘' })
    const after = await waitForStatus('r-clarify', notAnalyzing)
    expect(after.clarification).toBeNull()
    expect(after.plan!.tasks.length).toBeGreaterThan(0)
  })

  it('에디터 저장은 코드 작업 1개짜리 요청이 되고, 기준 커밋이 다르면 충돌이다', async () => {
    const saved = await editorApi.save('prj-auth', {
      baseCommit: '9b2f4e1',
      description: '응답 문구 수정',
      files: [{ path: 'src/index.ts', patch: '--- a/src/index.ts\n+++ b/src/index.ts\n' }],
    })
    expect(saved.source).toBe('EDITOR')
    const detail = await waitForStatus(saved.requestId, notAnalyzing)
    expect(detail.status).toBe('REVIEWING')
    expect(detail.plan!.tasks).toHaveLength(1)
    await expectError(
      editorApi.save('prj-auth', { baseCommit: 'old', description: 'x', files: [{ path: 'a', patch: 'b' }] }),
      'EDIT_CONFLICT',
    )
  })

  it('부분완료 재시도는 새 해시와 새 서명을 요구한다', async () => {
    const before = await requestsApi.get('r-partial')
    const retried = await requestsApi.retryFailed('r-partial')
    expect(retried.status).toBe('PENDING_APPROVAL')
    expect(retried.planHash).not.toBe(before.plan!.planHash)
    const detail = await requestsApi.get('r-partial')
    expect(detail.plan!.tasks.map((t) => t.status)).toEqual(['SUCCEEDED', 'PENDING'])
    asUser('u-07')
    const result = await signAndSubmitApproval({
      me: await me(),
      context: await approvalsApi.context('r-partial'),
      taskIds: ['t-2'],
    })
    expect(result.executionRequested).toBe(true)
    const finished = await waitForStatus('r-partial', (s) => s === 'COMPLETED')
    expect(finished.plan!.tasks.map((t) => t.status)).toEqual(['SUCCEEDED', 'SUCCEEDED'])
  })

  it('문서 적용은 새 버전을 저장하고, 롤백은 승인을 거쳐 이전 버전으로 되돌린다', async () => {
    asUser('u-07')
    const kim = await me()
    await signAndSubmitApproval({ me: kim, context: await approvalsApi.context('r-doc'), taskIds: ['t-1'] })
    await waitForStatus('r-doc', (s) => s === 'COMPLETED')

    asUser('u-01')
    await requestsApi.rollback('r-completed', { documentId: 'doc-readme', version: 1 })
    const rollback = await requestsApi.get('r-completed')
    expect(rollback.status).toBe('PENDING_APPROVAL')
    expect(rollback.plan!.kind).toBe('ROLLBACK')
    await signAndSubmitApproval({
      me: await me(),
      context: await approvalsApi.context('r-completed'),
      taskIds: ['t-1'],
    })
    const done = await waitForStatus('r-completed', (s) => s === 'ROLLED_BACK')
    expect(done.plan!.tasks[0].status).toBe('ROLLED_BACK')
    await expectError(requestsApi.rollback('r-partial', { documentId: 'doc-readme', version: 1 }), 'VALIDATION_ERROR')
  })

  it('승인 키 등록 흐름: 제출 → 대기 → 관리자 등록 → 승인 가능', async () => {
    asUser('u-21')
    expect((await me()).signingKeyStatus).toBe('NONE')
    const { publicKey } = signingService.generateDeviceKey('u-21')
    const webshellKey = await meApi.webshellPublicKey()
    const key = await meApi.submitSigningKey(publicKey)
    deviceStore.update('u-21', { keyId: key.keyId, pinnedWebshellKey: webshellKey })
    expect((await me()).signingKeyStatus).toBe('PENDING')
    const context = await approvalsApi.context('r-main')
    await expectError(
      signAndSubmitApproval({ me: await me(), context, taskIds: context.approvableTaskIds.length ? context.approvableTaskIds : ['t-2'] }),
      'NOT_APPROVER',
    )
    asUser('u-admin')
    await adminApi.registerKey(key.keyId)
    asUser('u-21')
    expect((await me()).signingKeyStatus).toBe('REGISTERED')
  })

  it('담당자라도 승인 키가 등록되기 전에는 KEY_NOT_REGISTERED이고, 등록 뒤에는 서명할 수 있다', async () => {
    asUser('u-21')
    const { publicKey } = signingService.generateDeviceKey('u-21')
    const key = await meApi.submitSigningKey(publicKey)
    deviceStore.update('u-21', { keyId: key.keyId, pinnedWebshellKey: await meApi.webshellPublicKey() })
    const { id } = await requestsApi.create({ projectId: 'prj-deploy', prompt: '스테이징에 배포해줘' })
    await waitForStatus(id, notAnalyzing)
    await requestsApi.submit(id)
    await expectError(approveAs('u-21', id, ['t-1']), 'KEY_NOT_REGISTERED')
    asUser('u-admin')
    await adminApi.registerKey(key.keyId)
    expect(await approveAs('u-21', id, ['t-1'])).toMatchObject({ executionRequested: true, status: 'RUNNING' })
  })

  it('킬 스위치는 남은 작업을 건너뛰고 끝낸다', async () => {
    const result = await requestsApi.kill('r-running', '잘못된 브랜치')
    expect(result.status).toBe('KILLED')
    expect(result.skippedTaskIds).toEqual(['t-long', 't-3'])
    await expectError(requestsApi.kill('r-running', '또'), 'INVALID_STATE')
  })

  it('직원의 감사 로그는 본인 요청으로 좁혀진다', async () => {
    asUser('u-21')
    const { items } = await auditApi.list({ limit: 100 })
    expect(items.length).toBeGreaterThan(0)
    const allowed = new Set(['r-failed', 'r-external', 'r-tampered-hash', 'r-display-mismatch'])
    expect(items.every((l) => l.target.requestId && allowed.has(l.target.requestId))).toBe(true)
  })
})

describe('쉬운 설명', () => {
  it('로그인 메시지 작업은 어디가 무엇에서 무엇으로 바뀌는지 알려 준다', async () => {
    const { plan } = await requestsApi.get('r-main')
    const explanation = plan!.tasks[0].explanation!
    expect(explanation.summary).toContain('로그인 실패')
    expect(explanation.changes[0]).toMatchObject({
      where: '로그인 API (POST /login)',
      before: 'Invalid credentials',
      after: '아이디 또는 비밀번호가 올바르지 않습니다',
    })
    expect(explanation.undo).toContain('되돌리기 기능이 없습니다')
  })

  it('배포·DB·조회·문서도 말로 풀어 쓴다', async () => {
    const deploy = (await requestsApi.get('r-main')).plan!.tasks[1].explanation!
    expect(deploy.summary).toContain('스테이징 서버')
    expect(deploy.impact.join()).toContain('운영 서비스에는 영향이 없습니다')
    const db = (await requestsApi.get('r-running')).plan!.tasks[1].explanation!
    expect(db.summary).toContain('last_login_at')
    const doc = (await requestsApi.get('r-completed')).plan!.tasks[0].explanation!
    expect(doc.undo).toContain('되돌릴 수 있습니다')
    expect(doc.changes[0].after).toBe('장애 대응')
  })

  it('설명은 해시 대상이 아니어서 바뀌어도 해시가 그대로다', async () => {
    const { plan } = await requestsApi.get('r-main')
    const hash = hashService.computePlanHash(plan!)
    const changed = { ...plan!, tasks: plan!.tasks.map((t) => ({ ...t, explanation: undefined })) }
    expect(hashService.computePlanHash(changed)).toBe(hash)
  })

  it('목록에 작업 요약이 함께 온다', async () => {
    const { items } = await requestsApi.list({ mine: true })
    const main = items.find((r) => r.id === 'r-main')!
    expect(main.taskSummary).toMatchObject({ total: 2, required: 2, approved: 1 })
    expect(main.taskSummary!.risks.HIGH).toBe(1)
  })

  it('담당자를 비활성화해 활성 담당자가 2명 아래로 내려가면 막는다', async () => {
    asUser('u-admin')
    await expectError(adminApi.updateUser('u-07', { active: false }), 'OWNER_MINIMUM')
  })

  it('다른 부서 직원은 제출 전 Plan을 볼 수 없다', async () => {
    asUser('u-21')
    await expectError(requestsApi.get('r-reviewing'), 'NOT_FOUND')
  })

  it('부분완료에서 실패 작업을 모두 지우고 제출하면 승인대기에 멈추지 않고 끝난다', async () => {
    const before = await requestsApi.get('r-partial')
    await requestsApi.patchPlan('r-partial', { basePlanId: before.currentPlanId!, changes: [{ op: 'DELETE', taskId: 't-2' }] })
    await waitForStatus('r-partial', notAnalyzing)
    const submitted = await requestsApi.submit('r-partial')
    expect(submitted.status).toBe('COMPLETED')
  })
})

describe('승인 화면의 무결성 확인 (명세 4.4)', () => {
  it('승인 자료는 Plan과 hashTarget을 함께 주고, 해시는 hashTarget으로 직접 계산한다', async () => {
    asUser('u-07')
    const context = await approvalsApi.context('r-main')
    expect(context).not.toHaveProperty('executorSignature')
    expect(Object.keys(context.plan).sort()).toEqual(['id', 'tasks'])
    expect(context.hashTarget).toMatchObject({ requestId: 'r-main', planId: context.plan.id, projectId: 'prj-auth' })
    expect(context.hashTarget.tasks.map((t) => Object.keys(t).sort())).toEqual([
      ['content', 'id', 'order', 'risk', 'target', 'type'],
      ['content', 'id', 'order', 'risk', 'target', 'type'],
    ])
    expect(hashService.computeTargetHash(context.hashTarget)).toBe(context.planHash)
    expect(verifyIntegrity(context, 'u-07')).toMatchObject({ hashOk: true, displayOk: true, keyMissing: false, ok: true })
  })

  it('화면에 보여 준 프로젝트가 서명 대상의 프로젝트와 다르면 서명하지 않는다', async () => {
    const request = storedRequest('r-external')
    request.plan!.projectId = 'prj-deploy'
    request.plan!.planHash = hashService.computePlanHash(request.plan!)
    asUser('u-07')
    const kim = await me()
    const context = await approvalsApi.context('r-external')
    expect(verifyIntegrity(context, kim.id, request.projectId)).toMatchObject({ hashOk: true, displayOk: false, ok: false })
    await expect(
      signAndSubmitApproval({ me: kim, context, taskIds: ['t-1'], shownProjectId: request.projectId }),
    ).rejects.toBeInstanceOf(IntegrityError)
    expect(request.approvalRecords).toEqual([])
  })

  it('본인 승인은 사용자가 검토한 Plan과 서명할 내용이 다르면 서명하지 않는다', async () => {
    const { id } = await requestsApi.create({ projectId: 'prj-auth', prompt: '로그인 테스트를 보강해줘' })
    await waitForStatus(id, notAnalyzing)
    const reviewed = await reviewedPlan(id)
    const request = storedRequest(id)
    request.plan!.tasks[0].target = 'src/auth/token.ts'
    const outcome = await submitWithSelfApproval(await me(), id, reviewed)
    expect(outcome.selfApprovedTaskIds).toEqual([])
    expect(outcome.selfApprovalError).toContain('검토한 Plan')
    expect(request.approvalRecords).toEqual([])
  })

  it('6-1: 해시가 재계산 값과 다르면 서명을 거부하고 서버에 아무것도 보내지 않는다', async () => {
    asUser('u-07')
    const kim = await me()
    const context = await approvalsApi.context('r-tampered-hash')
    expect(verifyIntegrity(context, kim.id)).toMatchObject({ hashOk: false, displayOk: true, ok: false })
    await expect(signAndSubmitApproval({ me: kim, context, taskIds: ['t-1'] })).rejects.toBeInstanceOf(IntegrityError)
    expect(storedRequest('r-tampered-hash').approvalRecords).toEqual([])
    expect((await requestsApi.get('r-tampered-hash')).status).toBe('PENDING_APPROVAL')
  })

  it('6-1: 해시가 맞아도 화면의 Plan이 hashTarget과 다르면 서명을 거부하고 서버에 아무것도 보내지 않는다', async () => {
    asUser('u-07')
    const kim = await me()
    const context = await approvalsApi.context('r-display-mismatch')
    expect(context.plan.tasks[0].content.command).toBe('./deploy.sh staging')
    expect(context.hashTarget.tasks[0].content.command).toBe('./deploy.sh production --force')
    expect(verifyIntegrity(context, kim.id)).toMatchObject({ hashOk: true, displayOk: false, ok: false })
    await expect(signAndSubmitApproval({ me: kim, context, taskIds: ['t-1'] })).rejects.toBeInstanceOf(IntegrityError)
    expect(storedRequest('r-display-mismatch').approvalRecords).toEqual([])
    expect((await requestsApi.get('r-display-mismatch')).status).toBe('PENDING_APPROVAL')
  })

  it('화면의 Plan에서 해시 대상 항목이 하나라도 다르면 일치하지 않는다', async () => {
    asUser('u-07')
    const honest = await approvalsApi.context('r-main')
    const changes: Array<(c: typeof honest) => void> = [
      (c) => void (c.plan.tasks[1].target = 'production'),
      (c) => void (c.plan.tasks[1].content = { command: './deploy.sh production' }),
      (c) => void (c.plan.tasks[1].risk = 'LOW'),
      (c) => void (c.plan.tasks[1].type = 'DOC'),
      (c) => void (c.plan.tasks[1].order = 9),
      (c) => void (c.plan.tasks[1].id = 't-9'),
      (c) => void c.plan.tasks.reverse(),
      (c) => void c.plan.tasks.pop(),
      (c) => void (c.plan.id = 'p-other'),
      (c) => void (c.requestId = 'r-other'),
    ]
    for (const change of changes) {
      const context = structuredClone(honest)
      change(context)
      expect(verifyIntegrity(context, 'u-07')).toMatchObject({ hashOk: true, displayOk: false, ok: false })
    }
    // 제목은 해시 대상이 아니어서 비교하지 않는다. 서명 기준은 실제 변경 내용이다.
    const retitled = structuredClone(honest)
    retitled.plan.tasks[1].title = '다른 제목'
    expect(verifyIntegrity(retitled, 'u-07').displayOk).toBe(true)
  })

  it('고정해 둔 웹쉘 공개키가 없으면 해시가 맞아도 서명하지 않는다', async () => {
    asUser('u-07')
    const kim = await me()
    const context = await approvalsApi.context('r-main')
    deviceStore.update('u-07', { pinnedWebshellKey: undefined })
    expect(verifyIntegrity(context, kim.id)).toMatchObject({ hashOk: true, displayOk: true, keyMissing: true, ok: false })
    await expect(signAndSubmitApproval({ me: kim, context, taskIds: ['t-2'] })).rejects.toBeInstanceOf(IntegrityError)
  })
})

describe('웹쉘 실행 직전 검증 (명세 5.1)', () => {
  const failedChecksOf = async (requestId: string) => (await requestsApi.get(requestId)).failedChecks

  it('승인자가 확인한 뒤 Plan이 바뀌면 해시 불일치로 실행하지 않고 관리자·부서 관리자에게 알린다', async () => {
    asUser('u-07')
    const kim = await me()
    const context = await approvalsApi.context('r-main')
    storedRequest('r-main').plan!.tasks[1].content = { command: './deploy.sh staging --force' }
    const result = await signAndSubmitApproval({ me: kim, context, taskIds: ['t-2'] })
    expect(result).toMatchObject({ executionRequested: true, status: 'VERIFICATION_FAILED' })
    expect(await failedChecksOf('r-main')).toEqual(['PLAN_HASH_MISMATCH'])
    expect(db().webshell.usedNonces).toEqual([])
    expect(db().logs['r-main']).toBeUndefined()
    const alerted = db().slackOutbox.filter((m) => m.text.includes('검증에 실패')).map((m) => m.toUserId)
    expect(alerted.sort()).toEqual(['u-admin', 'u-mgr-be'])
    const log = db().auditLogs.find((l) => l.action === 'VERIFICATION_FAILED' && l.target.requestId === 'r-main')
    expect(log?.detail.failedChecks).toEqual(['PLAN_HASH_MISMATCH'])
    expect(log?.actor.name).toBe('웹쉘')
  })

  it('이미 실행에 쓴 서명을 다시 보내면 NONCE_ALREADY_USED로 거부한다', async () => {
    await approveAs('u-07', 'r-main', ['t-2'])
    const request = storedRequest('r-main')
    expect(request.status).toBe('RUNNING')
    expect(db().webshell.usedNonces).toHaveLength(2)
    const approvals = request.approvalRecords.map(({ keyId, envelope }) => ({ keyId, envelope }))
    const replay = verifyExecution({ plan: toHashTarget(request.plan!), approvals }, request)
    expect(replay.failed).toContain('NONCE_ALREADY_USED')
    expect(db().webshell.usedNonces).toHaveLength(2)
  })

  it('한 요청에 같은 서명이 두 번 들어 있으면 하나만 인정하고 1회용 ID를 소진하지 않는다', () => {
    const request = storedRequest('r-main')
    const [{ keyId, envelope }] = request.approvalRecords
    const twice = [
      { keyId, envelope },
      { keyId, envelope },
    ]
    const result = verifyExecution({ plan: toHashTarget(request.plan!), approvals: twice }, request)
    expect(result.failed).toContain('NONCE_ALREADY_USED')
    expect(result.keyId).toBe(keyId)
    expect(db().webshell.usedNonces).toEqual([])
  })

  it('서명 뒤에 폐기된 키는 KEY_NOT_REGISTERED로 거부한다', async () => {
    asUser('u-admin')
    await adminApi.revokeKey('k-01-a')
    expect(db().webshell.policy.keys.some((k) => k.keyId === 'k-01-a')).toBe(false)
    const result = await approveAs('u-07', 'r-main', ['t-2'])
    expect(result.status).toBe('VERIFICATION_FAILED')
    expect(await failedChecksOf('r-main')).toContain('KEY_NOT_REGISTERED')
  })

  it('암호문이 변조됐거나 고정한 키가 아닌 키로 암호화됐으면 DECRYPT_FAILED로 거부한다', async () => {
    const other = bytesToBase64(x25519.getPublicKey(x25519.utils.randomSecretKey()))
    deviceStore.update('u-07', { pinnedWebshellKey: { ...WEBSHELL_PUBLIC_KEY, encryptionKey: other } })
    const result = await approveAs('u-07', 'r-main', ['t-2'])
    expect(result.status).toBe('VERIFICATION_FAILED')
    expect(await failedChecksOf('r-main')).toContain('DECRYPT_FAILED')

    const request = storedRequest('r-external')
    const broken = { alg: 'HPKE-X25519-AES256GCM' as const, encapsulatedKey: 'x', ciphertext: 'bm90IGpzb24=' }
    const checked = verifyExecution({ plan: toHashTarget(request.plan!), approvals: [{ keyId: 'k-07-a', envelope: broken }] }, request)
    expect(checked.failed).toContain('DECRYPT_FAILED')
  })

  it('고정한 웹쉘 공개키 모양이 잘못됐으면 봉투를 보내지 않고 이유를 알려 준다', async () => {
    const before = storedRequest('r-main').approvalRecords.length
    deviceStore.update('u-07', { pinnedWebshellKey: { ...WEBSHELL_PUBLIC_KEY, encryptionKey: bytesToBase64(new Uint8Array(44)) } })
    await expect(approveAs('u-07', 'r-main', ['t-2'])).rejects.toThrow('승인을 암호화하지 못해 제출하지 않았습니다. 웹쉘 공개키는 32바이트')
    expect(storedRequest('r-main').approvalRecords).toHaveLength(before)
    expect(storedRequest('r-main').status).toBe('PENDING_APPROVAL')
  })

  it('서명이 공개키로 검증되지 않거나 키 주인이 승인자와 다르면 SIGNATURE_INVALID다', () => {
    const request = storedRequest('r-main')
    const plan = toHashTarget(request.plan!)
    const encryption = WEBSHELL_PUBLIC_KEY.encryptionKey
    const [record] = request.approvalRecords
    const signed = openEnvelope(record.envelope)
    const widened = { ...signed, payload: { ...signed.payload, taskIds: ['t-1', 't-2'] } }
    const forged = verifyExecution(
      { plan, approvals: [{ keyId: record.keyId, envelope: cryptoService.encryptForWebshell(widened, encryption) }] },
      request,
    )
    expect(forged.failed).toContain('SIGNATURE_INVALID')

    const wrongOwner = signingService.sign('u-01', { ...signed.payload, approverId: 'u-07', nonce: 'n-other' })
    const owner = verifyExecution(
      { plan, approvals: [{ keyId: record.keyId, envelope: cryptoService.encryptForWebshell(wrongOwner, encryption) }] },
      request,
    )
    expect(owner.failed).toContain('SIGNATURE_INVALID')
  })

  it('서비스가 승인 규칙을 낮추거나 승인을 지어내도 웹쉘 정책과 서명으로만 판단한다', async () => {
    const request = storedRequest('r-main')
    request.plan!.tasks[1].requiredApprovers = [{ rule: 'ANYONE', count: 1 }]
    const lowered = await approveAs('u-mgr-in', 'r-main', ['t-2'])
    expect(lowered.status).toBe('VERIFICATION_FAILED')
    expect(await failedChecksOf('r-main')).toEqual(['MISSING_REQUIRED_APPROVER'])

    const invented = storedRequest('r-external')
    for (const task of invented.plan!.tasks) task.status = 'APPROVED'
    expect(requestExecution(invented)).toBe(true)
    expect(invented.status).toBe('VERIFICATION_FAILED')
    expect(invented.failedChecks).toEqual(['MISSING_REQUIRED_APPROVER'])
  })

  it('프리셋은 웹쉘 정책 사본에도 배포되어, 그 전에 모인 서명만으로는 실행하지 않는다', async () => {
    asUser('u-admin')
    await adminApi.applyPreset('MEDIUM')
    expect(db().webshell.policy.preset).toBe('MEDIUM')
    const result = await approveAs('u-07', 'r-main', ['t-2'])
    expect(result.status).toBe('VERIFICATION_FAILED')
    expect(await failedChecksOf('r-main')).toEqual(['MISSING_REQUIRED_APPROVER'])
  })

  it('승인 기준표 수정도 웹쉘 정책 사본에 반영된다', async () => {
    asUser('u-admin')
    const rows = db().matrix.map((row) => (row.taskType === 'CODE_FEATURE' ? { ...row, approverRule: 'PROJECT_OWNER' as const } : row))
    await adminApi.updateMatrix(rows)
    expect(db().webshell.policy.matrix.find((r) => r.taskType === 'CODE_FEATURE')?.approverRule).toBe('PROJECT_OWNER')
  })

  it('금지 규칙 해제 요청은 웹쉘 정책을 바꾸지 않아 실행 직전에 계속 막힌다', async () => {
    asUser('u-admin')
    const rule = await forbiddenApi.addRule({ departmentId: 'd-backend', taskType: 'DEPLOY', target: 'staging', reason: '동결' })
    await forbiddenApi.release(rule.id)
    const result = await approveAs('u-07', 'r-main', ['t-2'])
    expect(result.status).toBe('VERIFICATION_FAILED')
    expect(await failedChecksOf('r-main')).toEqual(['FORBIDDEN_TASK'])
  })

  describe('서비스를 믿지 않는다', () => {
    const forgeOnExternal = (edit: (tasks: Task[]) => void) => {
      const request = storedRequest('r-external')
      edit(request.plan!.tasks)
      expect(requestExecution(request)).toBe(true)
      return request
    }

    it('위험도를 금지로 표시한 작업은 서명 없이 실행되지 않는다', () => {
      const request = forgeOnExternal((tasks) => {
        for (const task of tasks) {
          task.risk = 'FORBIDDEN'
          task.status = 'APPROVED'
        }
      })
      expect(request.status).toBe('VERIFICATION_FAILED')
      expect(request.failedChecks).toContain('FORBIDDEN_TASK')
    })

    it('작업 상태를 실행중으로 바꿔도 서명 검사를 건너뛰지 않는다', () => {
      // t-1에는 진짜 서명이 있어, t-2를 검증에서 빼면 통과하고 t-2가 실행된다.
      const request = storedRequest('r-main')
      const [signed, unsigned] = request.plan!.tasks
      expect(request.approvalRecords.length).toBeGreaterThan(0)
      signed.status = 'APPROVED'
      unsigned.status = 'RUNNING'
      expect(requestExecution(request)).toBe(true)
      expect(request.status).toBe('VERIFICATION_FAILED')
      expect(request.failedChecks).toEqual(['MISSING_REQUIRED_APPROVER'])
    })

    it('실행할 작업이 없으면 빈 실행을 성공으로 끝내지 않는다', () => {
      const request = forgeOnExternal((tasks) => {
        for (const task of tasks) task.status = 'SKIPPED'
      })
      expect(request.status).toBe('VERIFICATION_FAILED')
      expect(request.failedChecks).toEqual(['MISSING_REQUIRED_APPROVER'])
    })

    it('누구나 승인할 수 있는 작업도 서명이 없으면 실행되지 않는다', () => {
      const request = forgeOnExternal(([first, second]) => {
        expect(first.requiredApprovers.map((r) => r.rule)).toEqual(['ANYONE'])
        first.status = 'APPROVED'
        second.status = 'SKIPPED'
      })
      expect(request.status).toBe('VERIFICATION_FAILED')
      expect(request.failedChecks).toEqual(['MISSING_REQUIRED_APPROVER'])
    })

    it('담당자 판단은 서명으로 확인한 Plan의 프로젝트로 한다', async () => {
      const request = storedRequest('r-external')
      request.plan!.projectId = 'prj-deploy'
      request.plan!.planHash = hashService.computePlanHash(request.plan!)
      const result = await approveAs('u-07', 'r-external', ['t-1', 't-2'])
      expect(result.status).toBe('VERIFICATION_FAILED')
      expect(await failedChecksOf('r-external')).toEqual(['MISSING_REQUIRED_APPROVER'])
    })

    it('위험도를 기준표의 기본값 아래로 낮춘 Plan은 통과하지 못한다', async () => {
      asUser('u-admin')
      await adminApi.applyPreset('MEDIUM')
      const request = storedRequest('r-external')
      request.plan!.tasks[1].risk = 'LOW'
      request.plan!.planHash = hashService.computePlanHash(request.plan!)
      const result = await approveAs('u-07', 'r-external', ['t-1', 't-2'])
      expect(result.status).toBe('VERIFICATION_FAILED')
      expect(await failedChecksOf('r-external')).toEqual(['MISSING_REQUIRED_APPROVER'])
    })

    it('기준표에 없는 유형은 가장 엄격한 규칙을 쓴다', () => {
      expect(requiredRules('DOC', 'LOW', 'SMALL', [])).toEqual(['PROJECT_OWNER'])
    })

    it('대상은 스테이징인데 명령이 금지 대상이면 막는다', async () => {
      asUser('u-admin')
      await forbiddenApi.addRule({ departmentId: 'd-backend', taskType: 'DEPLOY', target: 'production', reason: '동결' })
      const request = storedRequest('r-main')
      request.plan!.tasks[1].content = { command: './deploy.sh production --force' }
      expect(request.plan!.tasks[1].target).toBe('staging')
      const checked = verifyExecution({ plan: toHashTarget(request.plan!), approvals: [] }, request)
      expect(checked.failed).toContain('FORBIDDEN_TASK')
      expect(checked.forbiddenTaskIds).toEqual(['t-2'])
    })

    it('금지 대상 낱말은 명령과 쿼리에서 낱말 단위로 본다', () => {
      expect(hitsForbiddenTarget('prod', 'staging', { query: 'SELECT * FROM products' })).toBe(false)
      expect(hitsForbiddenTarget('prod', 'staging', { query: 'SELECT * FROM prod.users' })).toBe(true)
      expect(hitsForbiddenTarget('production', 'staging', { command: './deploy.sh production --force' })).toBe(true)
      expect(hitsForbiddenTarget('production', 'staging', { command: './deploy.sh staging' })).toBe(false)
      expect(hitsForbiddenTarget('prod', 'prod-db', {})).toBe(true)
      expect(hitsForbiddenTarget('*', 'staging', {})).toBe(true)
    })

    it('명령에 금지 대상이 있으면 서비스도 Plan 단계에서 금지로 표시해, 서명한 뒤 위변조 경보가 나지 않는다', async () => {
      asUser('u-admin')
      await forbiddenApi.addRule({ departmentId: 'd-backend', taskType: 'DEPLOY', target: 'canary', reason: '동결' })
      expect(findForbiddenReason('DEPLOY', 'staging', ['d-backend'], { command: './deploy.sh canary' })).not.toBeNull()
      expect(findForbiddenReason('DEPLOY', 'staging', ['d-backend'], { command: './deploy.sh staging' })).toBeNull()
      const project = db().projects.find((p) => p.id === 'prj-auth')!
      const task = toTask(
        { type: 'DEPLOY', title: '배포', description: '배포', target: 'staging', content: { command: './deploy.sh canary' } },
        1,
        project,
        (await me()) as never,
      )
      expect(task).toMatchObject({ risk: 'FORBIDDEN', status: 'BLOCKED' })
    })

    it('실행이 끝나면 세션을 닫아, 실행중으로 되돌려도 다시 실행하지 않는다', async () => {
      const { id } = await requestsApi.create({ projectId: 'prj-auth', prompt: '로그인 테스트를 보강해줘' })
      await waitForStatus(id, notAnalyzing)
      await submitWithSelfApproval(await me(), id, await reviewedPlan(id))
      await waitForStatus(id, (s) => s === 'COMPLETED')
      expect(db().webshell.sessions[id]).toBeUndefined()
      const request = storedRequest(id)
      const logged = db().logs[id].length
      request.status = 'RUNNING'
      request.plan!.tasks[0].status = 'APPROVED'
      scheduleExecution(id)
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(db().logs[id]).toHaveLength(logged)
    })

    it('배포 명령을 코드 수정으로 표시해 승인 규칙을 낮추지 못한다', async () => {
      const request = storedRequest('r-external')
      const deploy = request.plan!.tasks[1]
      expect(deploy.content.command).toBeTruthy()
      deploy.type = 'CODE_MINOR'
      deploy.risk = 'LOW'
      request.plan!.planHash = hashService.computePlanHash(request.plan!)
      expect((await approveAs('u-07', 'r-external', ['t-1', 't-2'])).status).toBe('VERIFICATION_FAILED')
      expect(await failedChecksOf('r-external')).toEqual(['FORBIDDEN_TASK'])
    })

    it('시드의 작업은 모두 유형에 맞는 내용을 가진다', () => {
      const mismatched = db().requests.flatMap((r) =>
        (r.plan?.tasks ?? []).filter((task) => !contentFitsType(task)).map((task) => `${r.id}/${task.id}`),
      )
      expect(mismatched).toEqual([])
    })

    it('검증 뒤에 서비스가 작업 상태를 바꿔도 세션에 없는 작업은 실행하지 않는다', async () => {
      const request = storedRequest('r-forbidden')
      asUser('u-01')
      await submitWithSelfApproval(await me(), 'r-forbidden', await reviewedPlan('r-forbidden'))
      const blocked = request.plan!.tasks.find((t) => t.status === 'BLOCKED')!
      expect(db().webshell.sessions['r-forbidden']).not.toContain(blocked.id)
      blocked.status = 'APPROVED'
      await waitForStatus('r-forbidden', (s) => s !== 'RUNNING')
      expect((db().logs['r-forbidden'] ?? []).some((line) => line.taskId === blocked.id)).toBe(false)
    })

    it('시드의 실행 중 요청은 세션이 열려 있어 계속 실행된다', () => {
      expect(db().webshell.sessions['r-running']).toContain('t-long')
    })

    it('검증을 거친 세션이 없으면 실행중으로 표시해도 아무것도 실행하지 않는다', async () => {
      const request = storedRequest('r-external')
      request.status = 'RUNNING'
      scheduleExecution(request.id)
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(request.status).toBe('RUNNING')
      expect(db().logs['r-external']).toBeUndefined()
    })
  })

  describe('규칙마다 다른 사람의 서명', () => {
    const requestOnDeploy = async () => {
      asUser('u-admin')
      await adminApi.applyPreset('MEDIUM')
      asUser('u-21')
      const { id } = await requestsApi.create({ projectId: 'prj-deploy', prompt: '스테이징에 배포해줘' })
      await waitForStatus(id, notAnalyzing)
      await requestsApi.submit(id)
      return id
    }

    it('한 사람의 서명으로 담당자와 부서 관리자 규칙을 함께 채우지 못한다', async () => {
      const id = await requestOnDeploy()
      const first = await approveAs('u-mgr-in', id, ['t-1'])
      expect(first).toMatchObject({ status: 'PENDING_APPROVAL', remainingTaskIds: ['t-1'] })
      const request = storedRequest(id)
      request.plan!.tasks[0].status = 'APPROVED'
      requestExecution(request)
      expect(request.status).toBe('VERIFICATION_FAILED')
      expect(request.failedChecks).toEqual(['MISSING_REQUIRED_APPROVER'])
    })

    it('담당자를 겸한 부서 관리자가 먼저 서명해도 다른 담당자의 서명으로 실행된다', async () => {
      const id = await requestOnDeploy()
      await approveAs('u-mgr-in', id, ['t-1'])
      expect(storedRequest(id).approvals.map((a) => a.rule)).toEqual(['DEPT_MANAGER'])
      const key = await registerKeyFor('u-21')
      expect(key.status).toBe('REGISTERED')
      const second = await approveAs('u-21', id, ['t-1'])
      expect(second).toMatchObject({ executionRequested: true, status: 'RUNNING' })
    })
  })

  describe('웹쉘은 서비스 정책이 아니라 자기 사본을 본다', () => {
    it('프리셋: 사본만 따른다', async () => {
      db().policy.preset = 'LARGE'
      expect((await approveAs('u-07', 'r-main', ['t-2'])).status).toBe('RUNNING')
    })

    it('기준표: 사본이 담당자를 요구하면 서비스 기준표가 누구나여도 막는다', async () => {
      db().webshell.policy.matrix = db().webshell.policy.matrix.map((row) => ({ ...row, approverRule: 'PROJECT_OWNER' as const }))
      expect((await approveAs('u-07', 'r-main', ['t-2'])).status).toBe('VERIFICATION_FAILED')
      expect(await failedChecksOf('r-main')).toEqual(['MISSING_REQUIRED_APPROVER'])
    })

    it('프리셋: 사본이 높으면 서비스가 낮아도 막는다', async () => {
      db().webshell.policy.preset = 'MEDIUM'
      expect((await approveAs('u-07', 'r-main', ['t-2'])).status).toBe('VERIFICATION_FAILED')
      expect(await failedChecksOf('r-main')).toEqual(['MISSING_REQUIRED_APPROVER'])
    })

    it('금지 규칙: 서비스에만 있으면 막지 않고, 사본에 있으면 막는다', async () => {
      asUser('u-admin')
      await forbiddenApi.addRule({ departmentId: 'd-backend', taskType: 'DEPLOY', target: 'staging', reason: '동결' })
      const copied = db().webshell.policy.forbiddenRules
      db().webshell.policy.forbiddenRules = []
      expect(verifyExecution({ plan: toHashTarget(storedRequest('r-main').plan!), approvals: [] }, storedRequest('r-main')).failed).not.toContain('FORBIDDEN_TASK')
      db().webshell.policy.forbiddenRules = copied
      db().forbiddenRules = []
      expect(verifyExecution({ plan: toHashTarget(storedRequest('r-main').plan!), approvals: [] }, storedRequest('r-main')).failed).toContain('FORBIDDEN_TASK')
    })

    it('공개키: 서비스에 등록되어 있어도 사본에 없으면 KEY_NOT_REGISTERED다', async () => {
      db().webshell.policy.keys = db().webshell.policy.keys.filter((key) => key.userId !== 'u-07')
      expect((await approveAs('u-07', 'r-main', ['t-2'])).status).toBe('VERIFICATION_FAILED')
      expect(await failedChecksOf('r-main')).toContain('KEY_NOT_REGISTERED')
    })
  })

  it('금지 규칙에 걸리는 문서 롤백은 승인대기로 가지 않는다', async () => {
    asUser('u-admin')
    await forbiddenApi.addRule({ departmentId: 'd-backend', taskType: 'DOC', target: 'docs/README.md', reason: '동결' })
    asUser('u-01')
    const before = storedRequest('r-completed').status
    await expectError(requestsApi.rollback('r-completed', { documentId: 'doc-readme', version: 1 }), 'FORBIDDEN_TASK')
    expect(storedRequest('r-completed').status).toBe(before)
  })

  it('승인된 작업이 없으면 실행 재시도 대상이 아니다', () => {
    const request = storedRequest('r-external')
    for (const task of request.plan!.tasks) task.status = 'BLOCKED'
    expect(isAwaitingExecution(request)).toBe(false)
    request.plan!.tasks[0].status = 'APPROVED'
    expect(isAwaitingExecution(request)).toBe(true)
  })
})

describe('웹쉘 연결 불가', () => {
  it('제출은 웹쉘 없이 되고, 승인이 다 모여도 연결할 수 없으면 executionRequested false로 승인대기에 남았다가 다시 시도한다', async () => {
    mockConfig.webshellReachable = false
    const { id } = await requestsApi.create({ projectId: 'prj-auth', prompt: '로그인 테스트를 보강해줘' })
    await waitForStatus(id, notAnalyzing)
    const outcome = await submitWithSelfApproval(await me(), id, await reviewedPlan(id))
    expect(outcome.submit.status).toBe('PENDING_APPROVAL')
    expect(outcome.submit.planHash).toMatch(/^sha256:/)
    expect(outcome.selfApprovedTaskIds).toEqual(['t-1'])
    expect(outcome.executionRequested).toBe(false)
    expect(outcome.executionDeferred).toBe(true)
    expect((await requestsApi.get(id)).status).toBe('PENDING_APPROVAL')
    expect(db().webshell.usedNonces).toEqual([])
    expect(db().logs[id]).toBeUndefined()

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect((await requestsApi.get(id)).status).toBe('PENDING_APPROVAL')

    mockConfig.webshellReachable = true
    const finished = await waitForStatus(id, (s) => s === 'COMPLETED')
    expect(finished.plan!.tasks.map((t) => t.status)).toEqual(['SUCCEEDED'])
  })

  it('담당자 승인도 연결할 수 없으면 executionRequested false다', async () => {
    mockConfig.webshellReachable = false
    const result = await approveAs('u-07', 'r-main', ['t-2'])
    expect(result).toMatchObject({ status: 'PENDING_APPROVAL', executionRequested: false, remainingTaskIds: [] })
    expect(result.approvedTaskIds).toEqual(['t-1', 't-2'])
    mockConfig.webshellReachable = true
    await waitForStatus('r-main', (s) => s === 'RUNNING' || s === 'COMPLETED')
  })

  it('다시 시도하기 전에 요청이 취소되면 실행하지 않는다', async () => {
    mockConfig.webshellReachable = false
    await approveAs('u-07', 'r-main', ['t-2'])
    asUser('u-01')
    await requestsApi.cancel('r-main')
    mockConfig.webshellReachable = true
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect((await requestsApi.get('r-main')).status).toBe('CANCELED')
    expect(db().webshell.usedNonces).toEqual([])
  })

  it('킬 스위치는 502 WEBSHELL_UNAVAILABLE이고 상태는 그대로다', async () => {
    mockConfig.webshellReachable = false
    await expect(requestsApi.kill('r-running', '멈춤')).rejects.toMatchObject({
      status: 502,
      code: 'WEBSHELL_UNAVAILABLE',
      message: '웹쉘에 연결할 수 없습니다',
    })
    expect((await requestsApi.get('r-running')).status).toBe('RUNNING')
    asUser('u-admin')
    await expect(adminApi.killAll('전체 중단')).rejects.toMatchObject({ status: 502, code: 'WEBSHELL_UNAVAILABLE' })
    expect((await requestsApi.get('r-running')).status).toBe('RUNNING')
    mockConfig.webshellReachable = true
    expect((await adminApi.killAll('전체 중단')).killedRequestIds).toEqual(['r-running'])
  })
})

describe('승인 기록과 웹쉘 키 (명세 2.5, 5장)', () => {
  it('승인 기록은 평문 메타데이터와 암호문만 보관하고, 승인자와 망은 서버가 채운다', async () => {
    asUser('u-07', 'EXTERNAL')
    const kim = await me()
    const context = await approvalsApi.context('r-external')
    await signAndSubmitApproval({ me: kim, context, taskIds: ['t-1'] })
    const [record] = storedRequest('r-external').approvalRecords
    expect(Object.keys(record).sort()).toEqual([
      'approverId',
      'createdAt',
      'envelope',
      'id',
      'keyId',
      'network',
      'planHash',
      'planId',
      'requestId',
      'taskIds',
    ])
    expect(record).toMatchObject({
      requestId: 'r-external',
      planId: context.plan.id,
      planHash: context.planHash,
      taskIds: ['t-1'],
      approverId: 'u-07',
      keyId: 'k-07-a',
      network: 'EXTERNAL',
    })
    expect(Object.keys(record.envelope).sort()).toEqual(['alg', 'ciphertext', 'encapsulatedKey'])
    expect(record.envelope.alg).toBe('HPKE-X25519-AES256GCM')

    await approveAs('u-01', 'r-doc', ['t-1'])
    expect(storedRequest('r-doc').approvalRecords[0]).toMatchObject({ approverId: 'u-01', network: 'INTERNAL' })
  })

  it('웹쉘 공개키는 내부망에서만 받고 X25519·Ed25519 키와 지문을 준다', async () => {
    const key = await meApi.webshellPublicKey()
    expect(key).toEqual(WEBSHELL_PUBLIC_KEY)
    expect(key.encryptionKey).not.toBe(key.signingKey)
    expect(key.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
    asUser('u-01', 'EXTERNAL')
    await expectError(meApi.webshellPublicKey(), 'INTERNAL_NETWORK_ONLY')
  })

  it('requiredApprovers는 규칙 목록이다', async () => {
    const { plan } = await requestsApi.get('r-main')
    expect(plan!.tasks[0].requiredApprovers).toEqual([{ rule: 'ANYONE', count: 1 }])
    expect(plan!.tasks[1].requiredApprovers).toEqual([{ rule: 'PROJECT_OWNER', count: 1, candidates: ['u-07', 'u-09'] }])
    const forbidden = (await requestsApi.get('r-forbidden')).plan!.tasks[0]
    expect(forbidden.requiredApprovers).toEqual([])
  })

  it('제출 응답에 옛 실행기 서명이 없다', async () => {
    const submitted = await requestsApi.submit('r-reviewing')
    expect(submitted).not.toHaveProperty('executorSignature')
    expect(submitted.planHash).toMatch(/^sha256:/)
  })
})

describe('웹쉘 서명 (명세 5장)', () => {
  const key = WEBSHELL_PUBLIC_KEY.signingKey
  const verify = signingService.verifyWebshellSignature

  it('실행 상태·결과·콜백·로그에 웹쉘 서명이 붙고, 내용이 바뀌면 확인되지 않는다', async () => {
    await approveAs('u-07', 'r-main', ['t-2'])
    const running = structuredClone(storedRequest('r-main').execution!)
    expect(running.status).toBe('RUNNING')
    const { webshellSignature, ...runningBody } = running
    expect(verify(runningBody, webshellSignature, key)).toBe(true)
    expect(verify({ ...runningBody, status: 'COMPLETED' }, webshellSignature, key)).toBe(false)

    asUser('u-01')
    await waitForStatus('r-main', (s) => s === 'COMPLETED')
    const request = storedRequest('r-main')
    const { webshellSignature: finalSignature, ...finalBody } = request.execution!
    expect(finalBody).toMatchObject({ executionId: running.executionId, status: 'COMPLETED' })
    expect(finalBody.taskResults.every((t) => t.status === 'SUCCEEDED')).toBe(true)
    expect(verify(finalBody, finalSignature, key)).toBe(true)

    expect(request.webshellEvents.filter((e) => e.type !== 'STEP').map((e) => [e.type, e.taskId])).toEqual([
      ['TASK_STARTED', 't-1'],
      ['TASK_SUCCEEDED', 't-1'],
      ['TASK_STARTED', 't-2'],
      ['TASK_SUCCEEDED', 't-2'],
      ['FINAL_STATUS', undefined],
    ])
    for (const { webshellSignature: signature, ...event } of request.webshellEvents) {
      expect(verify(event, signature, key)).toBe(true)
    }

    const { items } = await requestsApi.logs('r-main', { limit: 100 })
    expect(items.length).toBeGreaterThan(5)
    for (const { webshellSignature: signature, ...line } of items) {
      expect(verify({ requestId: 'r-main', ...line }, signature, key)).toBe(true)
      expect(verify({ requestId: 'r-main', ...line, text: '지어낸 결과' }, signature, key)).toBe(false)
      expect(verify({ requestId: 'r-other', ...line }, signature, key)).toBe(false)
    }
  })

  it('검증 실패 경보와 킬 스위치의 최종 상태에도 서명이 붙는다', async () => {
    asUser('u-07')
    const kim = await me()
    const context = await approvalsApi.context('r-main')
    storedRequest('r-main').plan!.tasks[1].content = { command: './deploy.sh staging --force' }
    await signAndSubmitApproval({ me: kim, context, taskIds: ['t-2'] })
    const [{ webshellSignature: alertSignature, ...alert }] = storedRequest('r-main').webshellEvents
    expect(alert).toMatchObject({ type: 'VERIFICATION_FAILED', failedChecks: ['PLAN_HASH_MISMATCH'] })
    expect(verify(alert, alertSignature, key)).toBe(true)

    asUser('u-01')
    await requestsApi.kill('r-running', '멈춤')
    const killed = storedRequest('r-running')
    expect(killed.execution?.status).toBe('KILLED')
    const { webshellSignature: killSignature, ...killBody } = killed.execution!
    expect(verify(killBody, killSignature, key)).toBe(true)
    expect(killed.webshellEvents.at(-1)).toMatchObject({ type: 'FINAL_STATUS', status: 'KILLED' })
  })

  it('시드의 실행 로그도 웹쉘 키로 확인된다', async () => {
    const { items } = await requestsApi.logs('r-completed', { limit: 100 })
    expect(items.length).toBeGreaterThan(0)
    for (const { webshellSignature: signature, ...line } of items) {
      expect(verify({ requestId: 'r-completed', ...line }, signature, key)).toBe(true)
    }
    const { webshellSignature, ...execution } = storedRequest('r-completed').execution!
    expect(verify(execution, webshellSignature, key)).toBe(true)
  })
})
