/**
 * 진행 상황 트리 (기능 명세서 5.12, API 명세 2.6, 4.9).
 * 트리를 따로 저장하지 않고 요청 상태에서 다시 만들어, 지난번 트리와 비교한 차이를 스트림으로 보낸다.
 * 실행 단계 노드는 웹쉘 서명이 확인된 이벤트로만 만든다 (5.3).
 */
import { signingService } from '../../crypto/signingService'
import type {
  Plan,
  ProgressApprovalNode,
  ProgressNode,
  ProgressPlanNode,
  ProgressRequestNode,
  ProgressStepNode,
  ProgressStreamEvent,
  ProgressTaskNode,
  ProgressTree,
  Task,
  WebshellEvent,
} from '../types'
import { db, generation, nowIso, onDbChange, type StoredRequest } from './store'
import { WEBSHELL_PUBLIC_KEY } from './webshell'

/** 테스트에서 줄여 쓴다. */
export const progressConfig = {
  heartbeatMs: 30_000,
}

type VersionedEvent = Exclude<ProgressStreamEvent, { event: 'heartbeat' }>
/** 버전을 매기기 전의 변경. 서버와 같이 상태 변경만 패치로 보내고 나머지는 전체를 다시 받게 한다 */
type TreeChange = { nodeId: string; status: string } | 'replaced'

interface Tracker {
  version: number
  updatedAt: string
  root: ProgressRequestNode
  listeners: Set<(event: VersionedEvent) => void>
}

// ── 트리 만들기 ────────────────────────────────────────────

function isSignedByWebshell(event: WebshellEvent, requestId: string): boolean {
  const { webshellSignature, ...signed } = event
  return (
    event.requestId === requestId &&
    signingService.verifyWebshellSignature(signed, webshellSignature, WEBSHELL_PUBLIC_KEY.signing.publicKey)
  )
}

function stepNodes(request: StoredRequest, task: Task): ProgressStepNode[] {
  // 재시도로 승인을 다시 받는 작업에는 지난 실행의 단계를 남기지 않는다.
  if (task.status === 'PENDING' || task.status === 'APPROVED') return []
  const events = request.webshellEvents.filter(
    (event) => event.type === 'STEP' && event.taskId === task.id && isSignedByWebshell(event, request.id),
  )
  const lastExecution = events.at(-1)?.executionId
  const steps = new Map<string, ProgressStepNode>()
  for (const { step, executionId } of events) {
    if (!step || executionId !== lastExecution) continue
    steps.set(step.id, {
      id: `step:${step.id}`,
      type: 'STEP',
      label: step.label,
      status: step.status,
      logRange: step.logRange,
    })
  }
  return [...steps.values()]
}

/**
 * 서버 RequestProgressService.approvalNodes와 같다. 제출된 승인마다 approval:{승인 기록 id} 노드 하나,
 * 승인 대기 작업이면 필요 승인권자마다 approval:pending:{작업 id}:{순번} 노드 하나다.
 */
function approvalNodes(request: StoredRequest, plan: Plan, task: Task): ProgressApprovalNode[] {
  const nodes: ProgressApprovalNode[] = request.approvals
    .filter((approval) => approval.planId === plan.id && approval.taskId === task.id)
    .map((approval) => ({
      id: `approval:${approval.id}`,
      type: 'APPROVAL',
      label: approval.name,
      status: 'APPROVED',
      network: approval.network,
      at: approval.at,
    }))
  if (task.status === 'PENDING') {
    task.requiredApprovers.forEach((requirement, index) => {
      nodes.push({
        id: `approval:pending:${task.id}:${index}`,
        type: 'APPROVAL',
        status: 'PENDING',
        ...(requirement.candidates ? { candidates: requirement.candidates } : {}),
      })
    })
  }
  return nodes
}

function taskNodes(request: StoredRequest, plan: Plan): ProgressTaskNode[] {
  // 서버처럼 바로 앞 작업을 dependsOn으로 둔다.
  let previous: string | null = null
  return plan.tasks.map((task) => {
    const id = `task:${task.id}`
    const dependsOn = previous ? [previous] : []
    previous = id
    return {
      id,
      type: 'TASK',
      label: `${task.order}. ${task.title}`,
      taskType: task.type,
      risk: task.risk,
      status: task.status,
      dependsOn,
      children: [...approvalNodes(request, plan, task), ...stepNodes(request, task)],
    }
  })
}

function planNodes(request: StoredRequest): ProgressPlanNode[] {
  const history = request.planHistory ?? []
  const nodes: ProgressPlanNode[] = []
  if (request.plan) {
    const version = (history.at(-1)?.version ?? 0) + 1
    nodes.push({
      id: `plan:${request.plan.id}`,
      type: 'PLAN',
      label: `Plan v${version}`,
      status: 'CURRENT',
      ...(request.plan.planHash ? { planHash: request.plan.planHash } : {}),
      children: taskNodes(request, request.plan),
    })
  }
  for (const entry of [...history].reverse()) {
    nodes.push({
      id: `plan:${entry.plan.id}`,
      type: 'PLAN',
      label: `Plan v${entry.version}`,
      status: 'SUPERSEDED',
      collapsed: true,
      // TODO(spec): 목 전용. 서버의 대체된 Plan은 라벨뿐이라 펼쳐도 볼 것이 없다. 변경 이력을 보여 주는 시연을 위해 작업 요약을 따로 담는다.
      supersededAt: entry.supersededAt,
      supersededTasks: entry.plan.tasks.map((task) => ({
        label: `${task.order}. ${task.title}`,
        taskType: task.type,
        risk: task.risk,
      })),
      children: [],
    })
  }
  return nodes
}

export function buildProgressRoot(request: StoredRequest): ProgressRequestNode {
  return {
    id: `request:${request.id}`,
    type: 'REQUEST',
    label: request.prompt,
    status: request.status,
    children: planNodes(request),
  }
}

// ── 바뀐 노드 찾기 ─────────────────────────────────────────

function flatten(root: ProgressNode) {
  const nodes = new Map<string, { node: ProgressNode; parentId: string | null }>()
  const walk = (node: ProgressNode, parentId: string | null) => {
    nodes.set(node.id, { node, parentId })
    if ('children' in node) for (const child of node.children) walk(child, node.id)
  }
  walk(root, null)
  return nodes
}

/** 상태와 자식을 뺀 속성이 같은지 본다. */
function sameExceptStatus(before: ProgressNode, after: ProgressNode): boolean {
  const pick = (node: ProgressNode) => {
    const { status: _status, children: _children, ...rest } = node as ProgressNode & { children?: unknown }
    return JSON.stringify(Object.entries(rest).sort(([a], [b]) => a.localeCompare(b)))
  }
  return pick(before) === pick(after)
}

/** 서버는 노드 상태가 바뀌면 node.updated를, 구조가 바뀌면 tree.replaced를 보낸다. node.added는 없다 (RequestStreamService). */
function diffTrees(before: ProgressRequestNode, after: ProgressRequestNode): TreeChange[] {
  const previous = flatten(before)
  const next = flatten(after)
  if (previous.size !== next.size) return ['replaced']
  const changes: TreeChange[] = []
  for (const [id, { node, parentId }] of next) {
    const old = previous.get(id)
    if (!old || old.parentId !== parentId || !sameExceptStatus(old.node, node)) return ['replaced']
    if (old.node.status !== node.status) changes.push({ nodeId: id, status: node.status })
  }
  return changes
}

// ── 버전과 구독 ────────────────────────────────────────────

const trackers = new Map<string, Tracker>()
const openStreams = new Set<() => void>()
let trackedGeneration = generation

/** 시드로 되돌리면 이전 트리와 이어지지 않는다. 스트림을 끊어 클라이언트가 다시 연결하게 한다. */
function dropIfReseeded() {
  if (trackedGeneration === generation) return
  trackedGeneration = generation
  trackers.clear()
  openStreams.forEach((close) => close())
  openStreams.clear()
}

function sync(request: StoredRequest): Tracker {
  dropIfReseeded()
  const root = buildProgressRoot(request)
  const tracker = trackers.get(request.id)
  if (!tracker) {
    const created: Tracker = { version: 1, updatedAt: request.updatedAt, root, listeners: new Set() }
    trackers.set(request.id, created)
    return created
  }
  const changes = diffTrees(tracker.root, root)
  if (changes.length === 0) return tracker
  tracker.root = root
  tracker.updatedAt = nowIso()
  for (const change of changes) {
    tracker.version += 1
    const id = tracker.version
    const event: VersionedEvent =
      change === 'replaced'
        ? { id, event: 'tree.replaced', data: { version: id } }
        : { id, event: 'node.updated', data: { ...change, at: nowIso() } }
    tracker.listeners.forEach((listener) => listener(event))
  }
  return tracker
}

// 승인과 실행은 모두 저장으로 끝난다. 그때 지켜보는 요청의 트리만 다시 비교한다.
onDbChange(() => {
  dropIfReseeded()
  for (const [requestId, tracker] of trackers) {
    if (tracker.listeners.size === 0) continue
    const request = db().requests.find((r) => r.id === requestId)
    if (request) sync(request)
  }
})

export function progressTree(request: StoredRequest): ProgressTree {
  const { version, updatedAt, root } = sync(request)
  return { requestId: request.id, version, updatedAt, root }
}

/** 서버처럼 지난 이벤트를 다시 보내지 않는다. Last-Event-ID가 지금 버전과 다르면 tree.replaced로 전체를 다시 받게 한다. */
function missedEvents(tracker: Tracker, lastEventId: string | null): VersionedEvent[] {
  if (lastEventId === null || Number(lastEventId) === tracker.version) return []
  return [{ id: tracker.version, event: 'tree.replaced', data: { version: tracker.version } }]
}

function frame({ id, event, data }: ProgressStreamEvent): string {
  return `${id === null ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export function progressStream(
  request: StoredRequest,
  lastEventId: string | null,
  signal: AbortSignal | undefined,
  canRead: () => boolean,
): Response {
  const encoder = new TextEncoder()
  let stop = () => {}
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const startedGeneration = generation
      const tracker = sync(request)
      let closed = false
      let heartbeat: ReturnType<typeof setInterval> | undefined
      const listener = (event: VersionedEvent) => send(event)
      stop = () => {
        closed = true
        clearInterval(heartbeat)
        tracker.listeners.delete(listener)
        openStreams.delete(close)
      }
      const close = () => {
        if (closed) return
        stop()
        controller.close()
      }
      const send = (event: ProgressStreamEvent) => {
        if (closed) return
        // 보던 중에 볼 수 없게 되면(승인 대기 중 Plan 수정 등) 더 보내지 않는다.
        if (!canRead()) close()
        else controller.enqueue(encoder.encode(frame(event)))
      }
      if (signal?.aborted) {
        close()
        return
      }
      openStreams.add(close)
      missedEvents(tracker, lastEventId).forEach(send)
      tracker.listeners.add(listener)
      heartbeat = setInterval(() => {
        if (startedGeneration !== generation) close()
        else send({ id: null, event: 'heartbeat', data: {} })
      }, progressConfig.heartbeatMs)
      signal?.addEventListener('abort', close)
    },
    cancel() {
      stop()
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
}
