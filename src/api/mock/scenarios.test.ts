// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signingService } from '../../crypto/signingService'
import { deviceStore } from '../../crypto/deviceStore'
import { canonicalize, hashService } from '../../crypto/hashService'
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
import type { Me, RequestStatus } from '../types'
import { devControls, initMock, mockFetch } from './index'
import { buildSeed } from './seed'
import { mockConfig } from './store'

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

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
  mockConfig.latencyMs = 0
  mockConfig.analysisMs = 1
  mockConfig.execStepMs = 1
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
    const outcome = await submitWithSelfApproval(hong, id)
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

    // 3. 김담당(내부망): 해시·실행기 서명 확인 → 서명 → 실행 요청
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
    const outcome = await submitWithSelfApproval(hong, 'r-main')
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
    await submitWithSelfApproval(await me(), 'r-main')
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
    const outcome = await submitWithSelfApproval(hong, 'r-forbidden')
    expect(outcome.selfApprovedTaskIds).toEqual(['t-2'])
    expect(outcome.executionRequested).toBe(true)
  })

  it('6-1: 해시나 실행기 서명이 어긋나면 무결성 확인에 실패해 서명할 수 없다', async () => {
    asUser('u-07')
    const kim = await me()
    const tampered = await approvalsApi.context('r-tampered-hash')
    expect(verifyIntegrity(tampered, kim.id)).toMatchObject({ hashOk: false, signatureOk: true, ok: false })
    const impostor = await approvalsApi.context('r-impostor-sign')
    expect(verifyIntegrity(impostor, kim.id)).toMatchObject({ hashOk: true, signatureOk: false, ok: false })
    await expect(signAndSubmitApproval({ me: kim, context: impostor, taskIds: ['t-1'] })).rejects.toBeInstanceOf(
      IntegrityError,
    )
  })

  it('6-2: 실행기 로컬 금지 규칙에 걸리면 검증실패가 되고 실패 항목이 남는다', async () => {
    asUser('u-admin')
    await forbiddenApi.addRule({ departmentId: 'd-backend', taskType: 'DEPLOY', target: 'staging', reason: '동결 기간' })
    asUser('u-07')
    const kim = await me()
    const context = await approvalsApi.context('r-main')
    const result = await signAndSubmitApproval({ me: kim, context, taskIds: ['t-2'] })
    expect(result.status).toBe('VERIFICATION_FAILED')
    const detail = await requestsApi.get('r-main')
    expect(detail.failedChecks).toContain('FORBIDDEN_TASK')
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
    const required = detail.plan!.tasks[0].requiredApprovers
    expect(required.rule).toBe('PROJECT_OWNER')
    expect(required.additional?.map((r) => r.rule)).toEqual(['DEPT_MANAGER'])

    await adminApi.applyPreset('LARGE')
    const large = await requestsApi.create({ projectId: 'prj-auth', prompt: '로그인 테스트를 보강해줘' })
    const low = await waitForStatus(large.id, notAnalyzing)
    expect(low.plan!.tasks[0].requiredApprovers.rule).toBe('SAME_DEPT_OTHER')
    // 대규모에서 낮음·중간은 요청자 외 같은 부서 1인이라 본인 승인이 없다.
    const outcome = await submitWithSelfApproval(await me(), large.id)
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
    const executorKey = await meApi.executorPublicKey()
    const key = await meApi.submitSigningKey(publicKey)
    deviceStore.update('u-21', { keyId: key.keyId, pinnedExecutorKey: executorKey.publicKey })
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
    const allowed = new Set(['r-failed', 'r-external', 'r-tampered-hash', 'r-impostor-sign'])
    expect(items.every((l) => l.target.requestId && allowed.has(l.target.requestId))).toBe(true)
  })
})
