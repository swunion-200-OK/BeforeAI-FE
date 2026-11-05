// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ed25519 } from '@noble/curves/ed25519.js'
import { deviceStore } from '../../crypto/deviceStore'
import { bytesToBase64 } from '../../crypto/encoding'
import { canonicalize } from '../../crypto/hashService'
import { signAndSubmitApproval } from '../../features/approvals/approvalFlow'
import { gateView } from '../../features/progress/progressStatus'
import { applyProgressEvent, findProgressNode } from '../../lib/progressTree'
import { setAccessToken, setTransport } from '../client'
import { approvalsApi, meApi, requestsApi } from '../endpoints'
import type {
  ProgressApprovalNode,
  ProgressNode,
  ProgressPlanNode,
  ProgressStepNode,
  ProgressStreamEvent,
  ProgressTaskNode,
  ProgressTree,
  RequestStatus,
  WebshellEvent,
} from '../types'
import { devControls, initMock, mockFetch } from './index'
import { progressConfig } from './progress'
import { buildSeed } from './seed'
import { db, mockConfig, persist, type StoredRequest } from './store'

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

const stored = (id: string) => db().requests.find((r) => r.id === id) as StoredRequest
const planOf = (tree: ProgressTree, index = 0) => tree.root.children[index] as ProgressPlanNode
const taskOf = (tree: ProgressTree, index: number) => planOf(tree).children[index] as ProgressTaskNode
const childrenOf = (task: ProgressTaskNode, type: ProgressNode['type']) => task.children.filter((n) => n.type === type)
const stepsOf = (task: ProgressTaskNode) => childrenOf(task, 'STEP') as ProgressStepNode[]
const approvalsOf = (task: ProgressTaskNode) => childrenOf(task, 'APPROVAL') as ProgressApprovalNode[]

async function approve(userId: string, requestId: string, taskIds: string[]) {
  asUser(userId)
  const approver = await meApi.get()
  await signAndSubmitApproval({ me: approver, context: await approvalsApi.context(requestId), taskIds })
}

async function waitForStatus(requestId: string, status: RequestStatus) {
  await vi.waitFor(
    async () => {
      expect((await requestsApi.get(requestId)).status).toBe(status)
    },
    { timeout: 4000, interval: 10 },
  )
}

/** 스트림을 열어 받은 이벤트를 쌓는다. */
function listen(requestId: string, lastVersion?: number) {
  const events: ProgressStreamEvent[] = []
  const controller = new AbortController()
  const ended = requestsApi.streamProgress(requestId, (event) => events.push(event), controller.signal, lastVersion)
  return { events, controller, ended }
}

const nextTick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms))

const stepEvent = (requestId: string, overrides: Partial<WebshellEvent> = {}): WebshellEvent => ({
  requestId,
  executionId: stored(requestId).execution?.executionId ?? null,
  type: 'STEP',
  at: new Date().toISOString(),
  taskId: 't-1',
  step: { id: 's-forged', label: 'rm -rf /', status: 'SUCCEEDED', logRange: { from: 1, to: 2 } },
  webshellSignature: '',
  ...overrides,
})

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
  mockConfig.latencyMs = 0
  mockConfig.analysisMs = 1
  mockConfig.execStepMs = 1
  mockConfig.webshellRetryMs = 1
  mockConfig.webshellReachable = true
  progressConfig.heartbeatMs = 30_000
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

describe('트리 모양 (명세 2.6)', () => {
  it('승인 대기: 요청 → Plan → 작업 → 승인, 대기 승인은 label 대신 candidates', async () => {
    const tree = await requestsApi.progress('r-main')
    expect(tree.root).toMatchObject({ id: 'request:r-main', type: 'REQUEST', status: 'PENDING_APPROVAL' })
    expect(tree.root.children).toHaveLength(1)
    expect(planOf(tree)).toMatchObject({ type: 'PLAN', label: 'Plan v1', status: 'CURRENT' })
    expect(planOf(tree).planHash).toMatch(/^sha256:/)

    const [first, second] = [taskOf(tree, 0), taskOf(tree, 1)]
    expect(first).toMatchObject({
      id: 'task:t-1',
      type: 'TASK',
      label: '1. 로그인 실패 메시지 변경',
      taskType: 'CODE_FEATURE',
      risk: 'MEDIUM',
      status: 'APPROVED',
      dependsOn: [],
    })
    expect(second).toMatchObject({ id: 'task:t-2', taskType: 'DEPLOY', risk: 'HIGH', status: 'PENDING', dependsOn: ['task:t-1'] })

    expect(approvalsOf(first)).toEqual([
      expect.objectContaining({ status: 'APPROVED', label: '홍길동', network: 'INTERNAL', at: expect.any(String) }),
    ])
    expect(approvalsOf(first)[0].candidates).toBeUndefined()

    const [pending] = approvalsOf(second)
    expect(pending.status).toBe('PENDING')
    expect(pending.label).toBeUndefined()
    // 서버처럼 후보는 ID로만 오고, 규칙은 노드에 없다.
    expect(pending.id).toBe('task:t-2/approval:pending:t-2:0')
    expect(pending.candidates).toEqual(['u-07', 'u-09'])
    expect(stepsOf(first)).toEqual([])
  })

  it('실행 중: 끝난 단계와 진행 중인 단계에 로그 구간이 붙는다', async () => {
    const tree = await requestsApi.progress('r-running')
    const [done, running, waiting] = [taskOf(tree, 0), taskOf(tree, 1), taskOf(tree, 2)]
    expect(stepsOf(done)).toEqual([
      { id: 'step:s-3', type: 'STEP', label: 'git apply tests_login.test.ts.patch', status: 'SUCCEEDED', logRange: { from: 3, to: 4 } },
    ])
    expect(stepsOf(running)).toEqual([
      { id: 'step:s-6', type: 'STEP', label: 'npm run migrate:up', status: 'RUNNING', logRange: { from: 6, to: null } },
    ])
    expect(db().logs['r-running'].find((line) => line.sequence === 6)?.message).toBe('$ npm run migrate:up')
    expect(waiting.status).toBe('APPROVED')
    expect(stepsOf(waiting)).toEqual([])
    expect(running.dependsOn).toEqual(['task:t-1'])
    expect(waiting.dependsOn).toEqual(['task:t-long'])
  })

  it('끝난 요청: 성공과 실패가 단계에 남는다', async () => {
    const completed = await requestsApi.progress('r-completed')
    expect(completed.root.status).toBe('COMPLETED')
    expect(stepsOf(taskOf(completed, 0))).toEqual([expect.objectContaining({ label: '문서 작성', status: 'SUCCEEDED' })])
    expect(stepsOf(taskOf(completed, 1))).toEqual([expect.objectContaining({ label: 'npm test', status: 'SUCCEEDED' })])
    expect(approvalsOf(taskOf(completed, 1))[0]).toMatchObject({ label: '김담당', network: 'EXTERNAL' })

    const partial = await requestsApi.progress('r-partial')
    expect(stepsOf(taskOf(partial, 1))).toEqual([expect.objectContaining({ label: './deploy.sh staging', status: 'FAILED' })])
  })

  it('거부는 작업 상태로만 나타나고, 금지 작업은 승인 노드가 없다. 선후 관계는 서버처럼 바로 앞 작업이다', async () => {
    const rejected = await requestsApi.progress('r-rejected')
    expect(taskOf(rejected, 0).status).toBe('REJECTED')
    expect(approvalsOf(taskOf(rejected, 0))).toEqual([])

    const forbidden = await requestsApi.progress('r-forbidden')
    expect(taskOf(forbidden, 0)).toMatchObject({ status: 'BLOCKED', risk: 'FORBIDDEN', dependsOn: [], children: [] })
    expect(taskOf(forbidden, 1).dependsOn).toEqual([taskOf(forbidden, 0).id])
  })

  it('대체된 Plan은 접힌 가지로 남고 자식이 없다', async () => {
    const tree = await requestsApi.progress('r-reapproval')
    expect(tree.root.children.map((plan) => [plan.type, plan.label, plan.status])).toEqual([
      ['PLAN', 'Plan v2', 'CURRENT'],
      ['PLAN', 'Plan v1', 'SUPERSEDED'],
    ])
    const old = planOf(tree, 1)
    expect(old).toMatchObject({ collapsed: true, children: [] })
    expect(old.supersededTasks).toEqual([
      { label: '1. 로그인 실패 메시지 변경', taskType: 'CODE_FEATURE', risk: 'MEDIUM' },
      { label: '2. 스테이징 배포', taskType: 'DEPLOY', risk: 'HIGH' },
    ])
    expect(planOf(tree).collapsed).toBeUndefined()
    expect(planOf(tree).children).toHaveLength(2)
  })

  it('서버처럼 제출 전에도 승인 대기 작업이면 필요 승인권자마다 대기 노드가 있다', async () => {
    const tree = await requestsApi.progress('r-reviewing')
    expect(tree.root.status).toBe('REVIEWING')
    expect(approvalsOf(taskOf(tree, 0)).map((node) => node.status)).toEqual(['PENDING'])
  })

  it('재시도하면 실패한 작업만 새 Plan에 옮겨지고, 다시 돈 작업은 새 실행의 단계만 보인다', async () => {
    const before = await requestsApi.progress('r-partial')
    const failedStep = stepsOf(taskOf(before, 1))[0]
    await requestsApi.retryFailed('r-partial')
    const retried = await requestsApi.progress('r-partial')
    expect(retried.root.children.map((plan) => [plan.label, plan.status])).toEqual([
      ['Plan v2', 'CURRENT'],
      ['Plan v1', 'SUPERSEDED'],
    ])
    expect(planOf(retried).children.map((task) => task.id)).toEqual(['task:t-2'])
    expect(stepsOf(taskOf(retried, 0))).toEqual([])

    await approve('u-07', 'r-partial', ['t-2'])
    asUser('u-01')
    await waitForStatus('r-partial', 'COMPLETED')
    const finished = await requestsApi.progress('r-partial')
    const steps = stepsOf(taskOf(finished, 0))
    expect(steps).toHaveLength(1)
    expect(steps[0].status).toBe('SUCCEEDED')
    expect(steps[0].id).not.toBe(failedStep.id)
  })

  it('문서 롤백 Plan은 이전 Plan을 대체된 가지로 남긴다', async () => {
    await requestsApi.rollback('r-completed', { taskIds: ['t-1'], targetVersion: 1 })
    const tree = await requestsApi.progress('r-completed')
    expect(tree.root.children.map((plan) => [plan.label, plan.status])).toEqual([
      ['Plan v2', 'CURRENT'],
      ['Plan v1', 'SUPERSEDED'],
    ])
  })

  it('Plan을 고치면 이전 Plan이 대체된 가지로 쌓인다', async () => {
    const before = await requestsApi.progress('r-main')
    await requestsApi.patchPlan('r-main', {
      basePlanId: planOf(before).id.replace('plan:', ''),
      changes: [{ op: 'UPDATE', taskId: 't-1', instruction: '영어 문구도 넣어줘' }],
    })
    await waitForStatus('r-main', 'REAPPROVAL_REQUIRED')
    const after = await requestsApi.progress('r-main')
    expect(after.root.children.map((plan) => [plan.label, plan.status])).toEqual([
      ['Plan v2', 'CURRENT'],
      ['Plan v1', 'SUPERSEDED'],
    ])
    expect(planOf(after, 1).id).toBe(planOf(before).id)
  })
})

describe('실행 단계는 웹쉘 서명이 확인된 이벤트로만 만든다 (5.12, 5.3)', () => {
  const stepIds = (tree: ProgressTree, index: number) => stepsOf(taskOf(tree, index)).map((step) => step.id)

  it('서명 없는 이벤트, 다른 키로 서명한 이벤트는 노드가 되지 않는다', async () => {
    const request = stored('r-completed')
    const before = await requestsApi.progress('r-completed')
    const forged = stepEvent('r-completed', { webshellSignature: 'AAAA' })
    const { webshellSignature: _ignored, ...unsigned } = stepEvent('r-completed', {
      step: { id: 's-other-key', label: '가짜 단계', status: 'SUCCEEDED', logRange: { from: 1, to: 2 } },
    })
    const otherKey = ed25519.utils.randomSecretKey()
    const wrongKey = {
      ...unsigned,
      webshellSignature: bytesToBase64(ed25519.sign(new TextEncoder().encode(canonicalize(unsigned)), otherKey)),
    }
    request.webshellEvents.push(forged, wrongKey)

    const after = await requestsApi.progress('r-completed')
    expect(JSON.stringify(after.root)).not.toContain('rm -rf')
    expect(JSON.stringify(after.root)).not.toContain('가짜 단계')
    expect(stepIds(after, 0)).toEqual(stepIds(before, 0))
    expect(after.version).toBe(before.version)
  })

  it('서명된 이벤트의 내용을 고치면 그 이벤트는 버려진다', async () => {
    const event = stored('r-completed').webshellEvents.find((e) => e.step?.status === 'SUCCEEDED') as WebshellEvent
    event.step = { ...(event.step as NonNullable<WebshellEvent['step']>), label: '변조된 단계' }
    const tree = await requestsApi.progress('r-completed')
    expect(JSON.stringify(tree.root)).not.toContain('변조된 단계')
  })

  it('다른 요청의 서명된 이벤트를 옮겨 붙여도 노드가 되지 않는다', async () => {
    const replay = stored('r-completed').webshellEvents.find((e) => e.type === 'STEP') as WebshellEvent
    stored('r-main').webshellEvents.push({ ...replay })
    stored('r-main').plan!.tasks[0].status = 'SUCCEEDED'
    const tree = await requestsApi.progress('r-main')
    expect(stepsOf(taskOf(tree, 0))).toEqual([])
  })

  it('실제 실행에서 나온 단계 이벤트는 서명이 확인되어 노드가 된다', async () => {
    await approve('u-07', 'r-main', ['t-2'])
    asUser('u-01')
    await waitForStatus('r-main', 'COMPLETED')
    const tree = await requestsApi.progress('r-main')
    expect(stepsOf(taskOf(tree, 0)).map((step) => [step.label, step.status])).toEqual([
      ['git switch -c ai/r-main', 'SUCCEEDED'],
      ['git apply src_auth_login.ts.patch', 'SUCCEEDED'],
      ['npm test', 'SUCCEEDED'],
      ['git push origin ai/r-main', 'SUCCEEDED'],
    ])
    const deploy = stepsOf(taskOf(tree, 1))
    expect(deploy.map((step) => [step.label, step.status])).toEqual([['./deploy.sh staging', 'SUCCEEDED']])
    const lines = db().logs['r-main'].filter((line) => line.sequence >= deploy[0].logRange!.from && line.sequence <= (deploy[0].logRange!.to as number))
    expect(lines[0].message).toBe('$ ./deploy.sh staging')
    expect(lines.at(-1)?.message).toBe('[t-2] 성공')
  })

  it('킬 스위치로 멈추면 진행 중이던 단계는 건너뜀이 된다', async () => {
    await requestsApi.kill('r-running', '멈춤')
    const tree = await requestsApi.progress('r-running')
    expect(stepsOf(taskOf(tree, 1))).toEqual([expect.objectContaining({ status: 'SKIPPED', logRange: { from: 6, to: 6 } })])
    expect(taskOf(tree, 1).status).toBe('SKIPPED')
  })
})

describe('버전과 스트림 (명세 4.9)', () => {
  it('트리가 바뀌는 변경마다 version이 1씩 늘어난다', async () => {
    const first = await requestsApi.progress('r-main')
    expect((await requestsApi.progress('r-main')).version).toBe(first.version)

    stored('r-main').plan!.tasks[0].status = 'RUNNING'
    const second = await requestsApi.progress('r-main')
    expect(second.version).toBe(first.version + 1)

    stored('r-main').plan!.tasks[0].status = 'SUCCEEDED'
    stored('r-main').plan!.tasks[1].title = '운영 배포'
    // 상태 말고 다른 것도 바뀌면 패치 대신 tree.replaced 하나로 다시 받게 한다.
    expect((await requestsApi.progress('r-main')).version).toBe(second.version + 1)
  })

  it('승인이 들어오거나 노드가 늘면 tree.replaced를 보낸다. node.added는 서버에 없다', async () => {
    const { version } = await requestsApi.progress('r-main')
    const stream = listen('r-main', version)
    await nextTick()
    await approve('u-07', 'r-main', ['t-2'])
    asUser('u-01')
    await waitForStatus('r-main', 'COMPLETED')
    const { version: last } = await requestsApi.progress('r-main')
    await vi.waitFor(() => expect(stream.events.at(-1)?.id).toBe(last))
    stream.controller.abort()
    await stream.ended

    const ids = stream.events.map((event) => event.id as number)
    expect(ids).toEqual(ids.map((_, index) => version + index + 1))

    expect(stream.events.some((e) => e.event === 'tree.replaced')).toBe(true)
    expect(stream.events.map((e) => e.event)).not.toContain('node.added')
    for (const event of stream.events) {
      if (event.event === 'node.updated') expect(Object.keys(event.data).sort()).toEqual(['at', 'nodeId', 'status'])
      if (event.event === 'tree.replaced') expect(event.data).toEqual({ version: event.id })
    }
  })

  it('상태만 바뀌면 이벤트를 차례로 적용한 트리가 전체를 다시 받은 트리와 같다', async () => {
    const start = await requestsApi.progress('r-main')
    const stream = listen('r-main', start.version)
    await nextTick()
    stored('r-main').plan!.tasks[0].status = 'RUNNING'
    persist()
    stored('r-main').plan!.tasks[0].status = 'SUCCEEDED'
    persist()
    await vi.waitFor(() => expect(stream.events).toHaveLength(2))
    stream.controller.abort()
    await stream.ended

    let patched = start
    for (const event of stream.events) {
      if (event.event === 'node.updated') patched = applyProgressEvent(patched, event) as ProgressTree
    }
    const fresh = await requestsApi.progress('r-main')
    expect(patched.version).toBe(fresh.version)
    expect(patched.root).toEqual(fresh.root)
  })

  it('패치는 바뀐 노드까지의 경로만 새로 만든다', async () => {
    const tree = await requestsApi.progress('r-main')
    const patched = applyProgressEvent(tree, {
      id: tree.version + 1,
      event: 'node.updated',
      data: { nodeId: 'task:t-2', status: 'APPROVED', at: new Date().toISOString() },
    }) as ProgressTree
    expect(findProgressNode(patched.root, 'task:t-2')).toMatchObject({ status: 'APPROVED' })
    expect(findProgressNode(patched.root, 'task:t-1')).toBe(findProgressNode(tree.root, 'task:t-1'))
    expect(findProgressNode(patched.root, 'task:t-2')).not.toBe(findProgressNode(tree.root, 'task:t-2'))
  })

  it('Plan이 바뀌면 tree.replaced를 보낸다', async () => {
    const before = await requestsApi.progress('r-main')
    const stream = listen('r-main', before.version)
    await nextTick()
    await requestsApi.patchPlan('r-main', {
      basePlanId: planOf(before).id.replace('plan:', ''),
      changes: [{ op: 'DELETE', taskId: 't-2' }],
    })
    await waitForStatus('r-main', 'REAPPROVAL_REQUIRED')
    await vi.waitFor(() => expect(stream.events.some((e) => e.event === 'tree.replaced')).toBe(true))
    stream.controller.abort()
    await stream.ended
    const after = await requestsApi.progress('r-main')
    expect(stream.events.at(-1)?.id).toBe(after.version)
  })

  it('30초마다 heartbeat를 보내고 버전은 올리지 않는다', async () => {
    progressConfig.heartbeatMs = 2
    const { version } = await requestsApi.progress('r-main')
    const stream = listen('r-main', version)
    await vi.waitFor(() => expect(stream.events.filter((e) => e.event === 'heartbeat').length).toBeGreaterThan(1))
    stream.controller.abort()
    await stream.ended
    expect(stream.events.every((e) => e.event === 'heartbeat' && e.id === null)).toBe(true)
    expect((await requestsApi.progress('r-main')).version).toBe(version)
  })

  it('Last-Event-ID가 최신이면 보낼 것이 없다', async () => {
    const { version } = await requestsApi.progress('r-main')
    const latest = listen('r-main', version)
    await nextTick()
    latest.controller.abort()
    await latest.ended
    expect(latest.events).toEqual([])
  })

  it('서버처럼 지난 이벤트를 다시 보내지 않고, Last-Event-ID가 지금 버전과 다르면 tree.replaced를 받는다', async () => {
    const { version } = await requestsApi.progress('r-main')
    stored('r-main').plan!.tasks[0].status = 'RUNNING'
    await requestsApi.progress('r-main')
    stored('r-main').plan!.tasks[0].status = 'SUCCEEDED'
    const latest = await requestsApi.progress('r-main')
    expect(latest.version).toBe(version + 2)

    for (const stale of [version, latest.version + 100]) {
      const stream = listen('r-main', stale)
      await vi.waitFor(() => expect(stream.events.length).toBeGreaterThan(0))
      stream.controller.abort()
      await stream.ended
      expect(stream.events).toEqual([expect.objectContaining({ id: latest.version, event: 'tree.replaced' })])
    }
  })

  it('중단하면 타이머를 멈추고, 시드로 되돌리면 스트림을 닫아 낡은 타이머를 남기지 않는다', async () => {
    progressConfig.heartbeatMs = 2
    const clearSpy = vi.spyOn(globalThis, 'clearInterval')
    const aborted = listen('r-main')
    await vi.waitFor(() => expect(aborted.events.length).toBeGreaterThan(0))
    const callsBefore = clearSpy.mock.calls.length
    aborted.controller.abort()
    await aborted.ended
    expect(clearSpy.mock.calls.length).toBeGreaterThan(callsBefore)
    const countAtAbort = aborted.events.length
    await nextTick(20)
    expect(aborted.events.length).toBe(countAtAbort)

    const reseeded = listen('r-main')
    await vi.waitFor(() => expect(reseeded.events.length).toBeGreaterThan(0))
    const before = await requestsApi.progress('r-main')
    stored('r-main').plan!.tasks[0].status = 'RUNNING'
    expect((await requestsApi.progress('r-main')).version).toBe(before.version + 1)
    buildSeed()
    await reseeded.ended
    asUser('u-01')
    expect((await requestsApi.progress('r-main')).version).toBe(1)
    clearSpy.mockRestore()
  })

  it('devControls.reset도 열린 스트림을 닫는다', async () => {
    progressConfig.heartbeatMs = 60_000
    await requestsApi.progress('r-main')
    const stream = listen('r-main')
    await nextTick()
    devControls.reset()
    await expect(stream.ended).resolves.toBeUndefined()
  })
})

describe('관문은 지금 Plan만 본다 (리뷰 회귀)', () => {
  const gateOf = async (id: string) => {
    asUser('u-01')
    const detail = await requestsApi.get(id)
    return gateView(detail)
  }

  it('부분완료를 재시도한 뒤 거부하면 지난 실행을 통과로 치지 않는다', async () => {
    const task = stored('r-partial').plan!.tasks[1]
    expect((await gateOf('r-partial')).phase).toBe('passed')
    await requestsApi.retryFailed('r-partial')
    asUser('u-07')
    await approvalsApi.reject('r-partial', { planId: stored('r-partial').plan!.id, taskIds: [task.id], reason: '다시 봅니다' })
    const view = await gateOf('r-partial')
    expect(view.phase).toBe('unreached')
    expect(view.checks.every((check) => check.state === 'none')).toBe(true)
  })

  it('완료 요청을 롤백 요청한 뒤 거부해도 통과라고 하지 않는다', async () => {
    await requestsApi.rollback('r-completed', { taskIds: ['t-1'], targetVersion: 1 })
    asUser('u-07')
    const taskIds = stored('r-completed').plan!.tasks.map((task) => task.id)
    await approvalsApi.reject('r-completed', { planId: stored('r-completed').plan!.id, taskIds, reason: '되돌리지 않습니다' })
    const view = await gateOf('r-completed')
    expect(view.phase).toBe('unreached')
    expect(view.checks.some((check) => check.state === 'passed')).toBe(false)
  })

  it('재시도해 다시 실행하면 그 실행으로 통과다', async () => {
    await requestsApi.retryFailed('r-partial')
    await approve('u-07', 'r-partial', ['t-2'])
    asUser('u-01')
    await waitForStatus('r-partial', 'COMPLETED')
    const view = await gateOf('r-partial')
    expect(view.phase).toBe('passed')
    expect(view.checks.every((check) => check.state === 'passed')).toBe(true)
  })

  it('서버 응답에는 목 전용 필드가 없어도 읽히고, 모르는 것을 통과라고 하지 않는다', async () => {
    const serverOnly = async (input: string, init: RequestInit = {}) => {
      const response = await mockFetch(input, init)
      if (!/\/requests\/[^/]+$/.test(new URL(input, 'http://x').pathname)) return response
      const { id, projectId, requester, prompt, source, status, analysisAttempts, currentPlanId, createdAt, updatedAt, currentPlan, approvals, clarification } = await response.json()
      return new Response(JSON.stringify({ id, projectId, requester, prompt, source, status, analysisAttempts, currentPlanId, createdAt, updatedAt, currentPlan, approvals, clarification }), { status: 200 })
    }
    setTransport(serverOnly)
    for (const id of ['r-partial', 'r-verify-failed', 'r-completed']) {
      const detail = await requestsApi.get(id)
      expect(detail.events).toBeUndefined()
      expect(gateView(detail).checks.some((check) => check.state === 'passed')).toBe(false)
    }
    expect(gateView(await requestsApi.get('r-completed')).phase).toBe('unknown')
    expect(gateView(await requestsApi.get('r-verify-failed')).phase).toBe('failed')
    // 서버의 RUNNING은 웹쉘이 실행 요청을 받아들인 뒤에만 된다. 승인 기록이 없으면 서명 검사는 말하지 않는다.
    const running = await requestsApi.get('r-running')
    expect(gateView(running).phase).toBe('passed')
    expect(gateView({ ...running, approvals: [] }).checks.slice(0, 4).some((check) => check.state === 'passed')).toBe(false)
    setTransport(mockFetch)
  })
})

describe('권한·접속 환경 (5.12)', () => {
  it('요청을 볼 수 없는 사람은 트리와 스트림 모두 막힌다', async () => {
    asUser('u-07')
    await expect(requestsApi.progress('r-reviewing')).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' })
    const controller = new AbortController()
    await expect(requestsApi.streamProgress('r-reviewing', () => {}, controller.signal)).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    })
  })

  it('보던 중에 볼 수 없게 되면 스트림이 닫히고 내용을 더 보내지 않는다', async () => {
    asUser('u-07')
    const { version } = await requestsApi.progress('r-main')
    const stream = listen('r-main', version)
    await nextTick()
    const request = stored('r-main')
    request.plan!.planHash = null
    request.plan!.tasks[1].title = '볼 수 없는 작업 제목'
    persist()
    await stream.ended
    expect(JSON.stringify(stream.events)).not.toContain('볼 수 없는 작업 제목')
    await expect(requestsApi.progress('r-main')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('외부망에서도 조회할 수 있고 실시간으로 받는다', async () => {
    asUser('u-01', 'EXTERNAL')
    const tree = await requestsApi.progress('r-running')
    expect(tree.root.status).toBe('RUNNING')
    const stream = listen('r-running', tree.version)
    await nextTick()
    stored('r-running').plan!.tasks[2].status = 'RUNNING'
    persist()
    await vi.waitFor(() => expect(stream.events.length).toBeGreaterThan(0))
    stream.controller.abort()
    await stream.ended
    expect(stream.events[0]).toMatchObject({ event: 'node.updated', data: { nodeId: 'task:t-3', status: 'RUNNING' } })
  })
})
