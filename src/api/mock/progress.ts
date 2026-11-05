/**
 * 진행 상황 트리 (기능 명세서 5.12, API 명세 2.6, 4.9).
 * 트리를 따로 저장하지 않고 요청 상태에서 다시 만들어, 지난번 트리와 비교한 차이를 스트림으로 보낸다.
 * 실행 단계 노드는 웹쉘 서명이 확인된 이벤트로만 만든다 (5.3).
 */
import { signingService } from '../../crypto/signingService'
import type {
  ApproverRule,
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
  /** 이 개수를 넘게 끊겼다가 돌아오면 이어 받지 못하고 tree.replaced를 받는다 */
  historyLimit: 50,
}

type VersionedEvent = Exclude<ProgressStreamEvent, { event: 'heartbeat' }>
/** 버전을 매기기 전의 변경 */
type TreeChange = VersionedEvent extends infer E ? (E extends VersionedEvent ? Omit<E, 'id'> : never) : never

interface Tracker {
  version: number
  updatedAt: string
  root: ProgressRequestNode
  history: VersionedEvent[]
  listeners: Set<(event: VersionedEvent) => void>
}

// ── 트리 만들기 ────────────────────────────────────────────

function isSignedByWebshell(event: WebshellEvent, requestId: string): boolean {
  const { webshellSignature, ...signed } = event
  return (
    event.requestId === requestId &&
    signingService.verifyWebshellSignature(signed, webshellSignature, WEBSHELL_PUBLIC_KEY.signingKey)
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
 * 승인 규칙 한 칸이 노드 하나다. 후보가 승인하면 같은 노드가 APPROVED로 바뀐다.
 * TODO(spec): 명세의 approval:{승인 기록 id}는 한 기록이 여러 작업을 담으면 트리 안에서 겹쳐, 작업과 규칙으로 정한다.
 */
function approvalNodes(request: StoredRequest, plan: Plan, task: Task): ProgressApprovalNode[] {
  const database = db()
  const nodes: ProgressApprovalNode[] = []
  // 제출 전이나 승인을 받지 않고 끝난 요청에는 기다리는 승인이 없다.
  const awaitingApproval = request.status === 'PENDING_APPROVAL' || request.status === 'REAPPROVAL_REQUIRED'
  let rejectionShown = false
  for (const requirement of task.requiredApprovers) {
    const rule: ApproverRule = requirement.rule
    const signed = request.approvals.filter((a) => a.planId === plan.id && a.taskId === task.id && a.rule === rule)
    const slots = Math.max(requirement.count, signed.length)
    for (let slot = 0; slot < slots; slot++) {
      const id = `approval:${task.id}:${rule}:${slot}`
      const approval = signed[slot]
      if (approval) {
        nodes.push({ id, type: 'APPROVAL', rule, label: approval.name, status: 'APPROVED', network: approval.network, at: approval.at })
      } else if (task.status === 'REJECTED' && request.rejection && !rejectionShown) {
        rejectionShown = true
        const rejected = database.auditLogs.find((log) => log.action === 'REJECTED' && log.target.requestId === request.id)
        nodes.push({
          id,
          type: 'APPROVAL',
          rule,
          label: request.rejection.by,
          status: 'REJECTED',
          at: request.rejection.at,
          ...(rejected ? { network: rejected.network } : {}),
        })
      } else if (task.status === 'PENDING' && awaitingApproval) {
        // TODO(spec): candidates의 모양과 rule은 명세에 없다. 화면에 이름을 쓰려고 결재 현황과 같은 모양으로 둔다. 누구나 승인하면 비어 있다.
        const candidates = (requirement.candidates ?? []).map((userId) => ({
          id: userId,
          name: database.users.find((user) => user.id === userId)?.name ?? userId,
        }))
        nodes.push({ id, type: 'APPROVAL', rule, status: 'PENDING', candidates })
      }
    }
  }
  return nodes
}

function taskNodes(request: StoredRequest, plan: Plan): ProgressTaskNode[] {
  // 선후 관계는 Plan 순서다 (5.2). 금지 작업은 실행되지 않으므로 사슬에서 뺀다.
  let previous: string | null = null
  return plan.tasks.map((task) => {
    const id = `task:${task.id}`
    const blocked = task.status === 'BLOCKED'
    const dependsOn = !blocked && previous ? [previous] : []
    if (!blocked) previous = id
    return {
      id,
      type: 'TASK',
      label: `${task.order}. ${task.title}`,
      taskType: task.type,
      // TODO(spec): 2.6 예시에서 risk를 확인할 수 없어 5.12의 "위험도 배지"를 근거로 넣었다.
      risk: task.risk,
      status: task.status,
      dependsOn,
      children: [...approvalNodes(request, plan, task), ...stepNodes(request, task)],
    }
  })
}

function planLabel(plan: Plan, version: number): string {
  return plan.kind === 'ROLLBACK' ? `문서 롤백 Plan v${version}` : `Plan v${version}`
}

function planNodes(request: StoredRequest): ProgressPlanNode[] {
  const history = request.planHistory ?? []
  const nodes: ProgressPlanNode[] = []
  if (request.plan) {
    const version = (history.at(-1)?.version ?? 0) + 1
    nodes.push({
      id: `plan:${request.plan.id}`,
      type: 'PLAN',
      label: planLabel(request.plan, version),
      status: 'CURRENT',
      // TODO(spec): 5.12의 "Plan v2 · 해시 4be1…"을 그리려고 넣었다. 2.6 예시에는 해시가 없다.
      planHash: request.plan.planHash,
      children: taskNodes(request, request.plan),
    })
  }
  for (const entry of [...history].reverse()) {
    nodes.push({
      id: `plan:${entry.plan.id}`,
      type: 'PLAN',
      label: planLabel(entry.plan, entry.version),
      status: 'SUPERSEDED',
      collapsed: true,
      planHash: entry.plan.planHash,
      // TODO(spec): 명세의 대체된 Plan은 children이 비어 있어 펼쳐도 볼 것이 없다. "변경 이력을 볼 수 있음"(5.12)을 위해 작업 요약을 따로 담는다.
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

/** 자식과 식별자를 뺀 속성 차이. 없어진 속성은 null로 보낸다. */
function fieldChanges(before: ProgressNode, after: ProgressNode): Record<string, unknown> | null {
  const skip = new Set(['id', 'type', 'children'])
  const a = before as unknown as Record<string, unknown>
  const b = after as unknown as Record<string, unknown>
  const changes: Record<string, unknown> = {}
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!skip.has(key) && JSON.stringify(a[key]) !== JSON.stringify(b[key])) changes[key] = b[key] ?? null
  }
  return Object.keys(changes).length > 0 ? changes : null
}

function diffTrees(before: ProgressRequestNode, after: ProgressRequestNode): TreeChange[] {
  const previous = flatten(before)
  const next = flatten(after)
  const replaced = (): TreeChange[] => [{ event: 'tree.replaced', data: { at: nowIso() } }]
  for (const id of previous.keys()) if (!next.has(id)) return replaced()

  const hadPlan = before.children.length > 0
  const changes: TreeChange[] = []
  let restructured = false
  const walk = (node: ProgressNode, parentId: string | null) => {
    const old = previous.get(node.id)
    if (!old) {
      if (node.type === 'PLAN' && hadPlan) restructured = true
      else changes.push({ event: 'node.added', data: { parentId: parentId as string, node } })
      return
    }
    if (old.parentId !== parentId) restructured = true
    const fields = fieldChanges(old.node, node)
    if (fields) {
      // 승인이 무효가 되어 시각이 없어지면 패치로 되돌리지 않고 전체를 다시 받게 한다.
      if (old.node.type === 'APPROVAL' && fields.at === null) restructured = true
      const at = typeof fields.at === 'string' ? fields.at : nowIso()
      changes.push({ event: 'node.updated', data: { ...fields, nodeId: node.id, at } })
    }
    if ('children' in node) for (const child of node.children) walk(child, node.id)
  }
  walk(after, null)
  return restructured ? replaced() : changes
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
    const created: Tracker = { version: 1, updatedAt: request.updatedAt, root, history: [], listeners: new Set() }
    trackers.set(request.id, created)
    return created
  }
  const changes = diffTrees(tracker.root, root)
  if (changes.length === 0) return tracker
  tracker.root = root
  tracker.updatedAt = nowIso()
  for (const change of changes) {
    tracker.version += 1
    const event = { ...change, id: tracker.version } as VersionedEvent
    tracker.history.push(event)
    tracker.listeners.forEach((listener) => listener(event))
  }
  tracker.history.splice(0, Math.max(0, tracker.history.length - progressConfig.historyLimit))
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
  return { version, updatedAt, root }
}

/** Last-Event-ID 뒤의 이벤트. 이어 받을 수 없으면 tree.replaced 하나로 전체를 다시 받게 한다 (명세 4.9). */
function missedEvents(tracker: Tracker, lastEventId: string | null): VersionedEvent[] {
  if (lastEventId === null) return []
  const last = Number(lastEventId)
  if (last === tracker.version) return []
  const missed = tracker.history.filter((event) => event.id > last)
  const canResume = Number.isInteger(last) && last < tracker.version && missed.length === tracker.version - last
  // TODO(spec): tree.replaced와 heartbeat의 본문은 명세에 없어 시각만 담는다.
  return canResume ? missed : [{ id: tracker.version, event: 'tree.replaced', data: { at: nowIso() } }]
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
        else send({ id: null, event: 'heartbeat', data: { at: nowIso() } })
      }, progressConfig.heartbeatMs)
      signal?.addEventListener('abort', close)
    },
    cancel() {
      stop()
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
}
