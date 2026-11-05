/**
 * 진행 상황 트리 위의 "지금" 문장, 진행 중인 경로, 웹쉘 검증 관문을 트리와 요청 상태에서 계산한다.
 * 화면에 쓰는 값만 만들고, 데이터가 말해 주지 않는 것은 주장하지 않는다.
 */
import type {
  ApproverRule,
  FailedCheck,
  Plan,
  ProgressApprovalNode,
  ProgressNode,
  ProgressRequestNode,
  ProgressStepNode,
  ProgressTaskNode,
  RequestDetail,
  RequestEvent,
  RequestStatus,
} from '../../api/types'
import { isAnalysisOverdue } from '../../lib/analysisWait'
import { josa } from '../../lib/josa'
import { FAILED_CHECK_LABEL, RULE_LABEL, forbiddenExcludedText } from '../../lib/labels'
import { allApprovedNowText } from '../requests/statusBannerText'

// ── 웹쉘 검증 관문 ─────────────────────────────────────────

/**
 * TODO(spec): 관문은 명세의 NodeType이 아니다. API 명세 5.1의 검증 순서를 화면에서 요청 상태와 failedChecks로 그린다.
 * 트리 API(2.6)에는 넣지 않는다. 명세에는 검사별 통과 결과가 없어, 아래 규칙으로 말할 수 있는 만큼만 말한다.
 */
export const GATE_ID = 'gate'

export const GATE_CHECKS: Array<{ key: string; name: string; codes: FailedCheck[]; bySignature?: boolean }> = [
  { key: 'decrypt', name: '복호화', codes: ['DECRYPT_FAILED'], bySignature: true },
  { key: 'hash', name: '해시 재계산', codes: ['PLAN_HASH_MISMATCH'], bySignature: true },
  { key: 'signature', name: '서명·키 주인', codes: ['SIGNATURE_INVALID', 'KEY_NOT_REGISTERED'], bySignature: true },
  { key: 'nonce', name: '1회용 ID', codes: ['NONCE_ALREADY_USED'], bySignature: true },
  { key: 'approver', name: '필요한 승인권자', codes: ['MISSING_REQUIRED_APPROVER'] },
  { key: 'forbidden', name: '금지 작업', codes: ['FORBIDDEN_TASK'] },
]

/** 문장에 넣는 짧은 말. 전체 설명은 FAILED_CHECK_LABEL이다 */
const FAILED_CHECK_SHORT: Record<FailedCheck, string> = {
  DECRYPT_FAILED: '승인 서명 복호화 실패',
  PLAN_HASH_MISMATCH: 'Plan 해시 불일치',
  SIGNATURE_INVALID: '서명 검증 실패',
  KEY_NOT_REGISTERED: '등록되지 않은 키',
  NONCE_ALREADY_USED: '이미 쓴 서명',
  MISSING_REQUIRED_APPROVER: '필요한 승인권자 서명 없음',
  FORBIDDEN_TASK: '금지 작업 포함',
}

/** unknown: 실행 기록을 받지 못해 관문을 지났는지 알 수 없다 */
export type GatePhase = 'waiting' | 'passed' | 'failed' | 'unreached' | 'unknown'
/** none: 데이터가 이 검사의 결과를 말해 주지 않는다 */
export type GateCheckState = 'waiting' | 'passed' | 'failed' | 'none'

export interface GateView {
  phase: GatePhase
  checks: Array<{ key: string; name: string; state: GateCheckState }>
  /** 쉬운 말로 쓴 실패 항목 */
  failures: string[]
}

const BEFORE_GATE: RequestStatus[] = ['ANALYZING', 'REVIEWING', 'PENDING_APPROVAL', 'REAPPROVAL_REQUIRED']
const RUN_STATUSES: RequestStatus[] = ['RUNNING', 'ROLLING_BACK']
/** 승인을 받는 중에만 갈 수 있어 지금 Plan은 관문에 닿지 않았다 */
const NEVER_REACHED: RequestStatus[] = ['ANALYSIS_FAILED', 'REJECTED', 'CANCELED']

type GateInput = Pick<RequestDetail, 'status'> & Partial<Pick<RequestDetail, 'failedChecks' | 'events' | 'approvals' | 'approvalRecordCount'>>

/**
 * 지금 Plan이 실행까지 갔는지. 진행 기록에는 Plan id가 없지만, 새 Plan은 승인 단계를 다시 거치므로
 * 마지막 실행 기록 뒤에 승인 전 단계가 없을 때만 지금 Plan의 실행이다.
 */
function currentPlanRan(events: RequestEvent[]): boolean {
  const lastRun = events.findLastIndex((event) => RUN_STATUSES.includes(event.status))
  return lastRun !== -1 && lastRun > events.findLastIndex((event) => BEFORE_GATE.includes(event.status))
}

export function gateView(request: GateInput): GateView {
  const { status, failedChecks = [], events = [], approvals = [], approvalRecordCount = approvals.length } = request
  const withState = (state: (codes: FailedCheck[], index: number) => GateCheckState) =>
    GATE_CHECKS.map(({ key, name, codes, bySignature }, index) => {
      const value = state(codes, index)
      // 승인 기록이 없거나 모르면 웹쉘이 확인한 서명을 알 수 없다. 서명으로 하는 검사는 통과라고 말하지 않는다.
      return { key, name, state: value === 'passed' && bySignature && !approvalRecordCount ? ('none' as const) : value }
    })

  if (BEFORE_GATE.includes(status)) {
    return { phase: 'waiting', checks: withState(() => 'waiting'), failures: [] }
  }
  if (status === 'VERIFICATION_FAILED') {
    const isFailed = (codes: FailedCheck[]) => codes.some((code) => failedChecks.includes(code))
    const firstFailed = GATE_CHECKS.findIndex(({ codes }) => isFailed(codes))
    return {
      phase: 'failed',
      // 첫 실패 앞은 통과한 것이다. 뒤의 검사는 웹쉘이 멈췄을 수 있어 말하지 않는다.
      checks: withState((codes, index) => {
        if (isFailed(codes)) return 'failed'
        return firstFailed !== -1 && index < firstFailed ? 'passed' : 'none'
      }),
      failures: failedChecks.map((code) => FAILED_CHECK_LABEL[code] ?? code),
    }
  }
  const none = withState(() => 'none')
  if (NEVER_REACHED.includes(status)) return { phase: 'unreached', checks: none, failures: [] }
  // 지금 실행 중이거나 지금 Plan의 실행 기록이 있어야 통과라고 말할 수 있다.
  if (RUN_STATUSES.includes(status) || currentPlanRan(events)) {
    return { phase: 'passed', checks: withState(() => 'passed'), failures: [] }
  }
  return { phase: events.length > 0 ? 'unreached' : 'unknown', checks: none, failures: [] }
}

// ── "지금" 문장과 경로 ─────────────────────────────────────

export type PathMode = 'wait' | 'running' | 'failed'

export interface ProgressNow {
  text: string
  /** 기다리기 시작한 실제 시각. 없으면 경과 시간을 쓰지 않는다 */
  since?: string
  /** 경로의 끝 노드. 끝난 요청처럼 진행 중인 곳이 없으면 비어 있다 */
  leaves: string[]
  mode: PathMode | null
}

/** 금지 작업은 해시 대상에서 빠져 실행되지 않는다. 관문의 금지 작업 검사도 실행 대상을 본다. */
export function countForbidden(tasks: Array<Pick<ProgressTaskNode, 'risk' | 'status'>>): number {
  return tasks.filter((task) => task.risk === 'FORBIDDEN' || task.status === 'BLOCKED').length
}

/** 금지 작업 칸의 낱말. 판정은 그대로 두고, 무엇을 기준으로 통과했는지만 말한다. */
export function forbiddenCheckWord(excluded: number): string {
  return `통과 (금지 ${excluded}개 제외)`
}

/** 트리가 칸보다 넓어 일부가 가려졌는지. 소수점 차이는 무시한다. */
export function isTreeClipped({ scrollWidth, clientWidth }: { scrollWidth: number; clientWidth: number }): boolean {
  return scrollWidth - clientWidth > 1
}

const title = (task: ProgressTaskNode) => task.label.replace(/^\d+\.\s*/, '')

function tasksOf(root: ProgressRequestNode): ProgressTaskNode[] {
  const plan = root.children.find((child) => child.type === 'PLAN' && child.status === 'CURRENT')
  return plan && 'children' in plan ? plan.children.filter((child): child is ProgressTaskNode => child.type === 'TASK') : []
}

const approvalsOf = (task: ProgressTaskNode) => task.children.filter((c): c is ProgressApprovalNode => c.type === 'APPROVAL')
const stepsOf = (task: ProgressTaskNode) => task.children.filter((c): c is ProgressStepNode => c.type === 'STEP')

function currentPlanId(root: ProgressRequestNode): string | undefined {
  return root.children.find((child) => child.type === 'PLAN' && child.status === 'CURRENT')?.id
}

function sinceStatus(events: RequestEvent[] | undefined, status: RequestStatus): string | undefined {
  return events?.findLast((event) => event.status === status)?.at
}

/**
 * 승인 대기 노드가 기다리는 규칙. 노드에는 규칙이 없지만 ID가 approval:pending:{작업 id}:{순번}이고
 * 순번이 requiredApprovers의 자리다 (RequestProgressService.approvalNodes). 후보는 ID로만 와서 사람 이름은 말하지 못한다.
 */
export function pendingRule(node: ProgressApprovalNode, plan: Pick<Plan, 'tasks'> | null | undefined): ApproverRule | undefined {
  const match = /approval:pending:(.+):(\d+)$/.exec(node.id)
  if (!match) return undefined
  return plan?.tasks.find((task) => task.id === match[1])?.requiredApprovers[Number(match[2])]?.rule
}

function waitingForApproval(root: ProgressRequestNode, since: string | undefined, plan: Pick<Plan, 'tasks'> | null | undefined): ProgressNow {
  const waiting = tasksOf(root).flatMap((task) => {
    const pending = approvalsOf(task).filter((node) => node.status === 'PENDING')
    return pending.length > 0 ? [{ task, pending }] : []
  })
  const leaves = waiting.flatMap(({ pending }) => pending.map((node) => node.id))
  if (waiting.length === 0) {
    // 승인 노드를 받지 못했을 뿐 승인을 기다리는 작업이 있으면 모였다고 말하지 않는다.
    const undecided = tasksOf(root).filter((task) => task.status === 'PENDING')
    if (undecided.length > 0) return { text: '승인을 기다립니다', since, leaves: undecided.map((task) => task.id), mode: 'wait' }
    return { text: allApprovedNowText(), since, leaves: [GATE_ID], mode: 'wait' }
  }
  if (waiting.length > 1) {
    const names = waiting.map(({ task }) => title(task)).join(', ')
    return { text: `작업 ${waiting.length}개가 승인을 기다립니다: ${names}`, since, leaves, mode: 'wait' }
  }
  const [{ task, pending }] = waiting
  const rules = pending.map((node) => pendingRule(node, plan))
  const who = [...new Set(rules.flatMap((rule) => (rule && rule !== 'ANYONE' ? [RULE_LABEL[rule]] : [])))].join(', ')
  const subject = josa(title(task), '이', '가')
  const anyone = rules.every((rule) => rule === 'ANYONE')
  const text = who ? `${subject} ${who}의 승인을 기다립니다` : anyone ? `${subject} 승인을 기다립니다 (누구나 승인 가능)` : `${subject} 승인을 기다립니다`
  return { text, since, leaves, mode: 'wait' }
}

function running(root: ProgressRequestNode, gateReplaying: boolean): ProgressNow {
  // 검증 장면이 끝나야 단계로 이어진다.
  if (gateReplaying) return { text: '웹쉘 검증을 통과해 실행을 시작합니다', leaves: [GATE_ID], mode: 'running' }
  const tasks = tasksOf(root)
  const task = tasks.find((candidate) => candidate.status === 'RUNNING')
  if (!task) return { text: '웹쉘 검증을 통과해 실행을 시작합니다', leaves: [GATE_ID], mode: 'running' }
  const step = stepsOf(task).findLast((candidate) => candidate.status === 'RUNNING')
  return {
    text: step ? `${title(task)} 실행 중: ${step.label}` : `${title(task)} 실행 중`,
    leaves: [step?.id ?? task.id],
    mode: 'running',
  }
}

function failedLeaves(root: ProgressRequestNode): string[] {
  return tasksOf(root).flatMap((task) => {
    if (task.status !== 'FAILED') return []
    const failed = stepsOf(task).filter((step) => step.status === 'FAILED')
    return failed.length > 0 ? failed.map((step) => step.id) : [task.id]
  })
}

/** 트리를 스트림으로 바로 따라가므로 상태는 트리 값을 쓰고, 사유와 시각은 요청 상세에서 가져온다. */
export function progressNow(
  root: ProgressRequestNode,
  request: Partial<Pick<RequestDetail, 'failedChecks' | 'rejection' | 'kill' | 'events' | 'requester' | 'currentPlan' | 'updatedAt'>> | undefined,
  gateReplaying = false,
): ProgressNow {
  const events = request?.events
  const plan = currentPlanId(root)
  const tasks = tasksOf(root)
  const firstFailed = tasks.find((task) => task.status === 'FAILED')
  const requester = request?.requester?.name ? `${request.requester.name}의 ` : ''

  switch (root.status) {
    case 'ANALYZING':
      if (request?.updatedAt && isAnalysisOverdue({ updatedAt: request.updatedAt })) {
        return { text: '분석이 평소보다 오래 걸리고 있습니다', since: request.updatedAt, leaves: [plan ?? root.id], mode: 'wait' }
      }
      return { text: 'AI가 요청을 분석하고 있습니다', since: sinceStatus(events, 'ANALYZING'), leaves: [plan ?? root.id], mode: 'wait' }
    case 'ANALYSIS_FAILED':
      return { text: 'AI 분석에 실패했습니다', leaves: [root.id], mode: 'failed' }
    case 'REVIEWING':
      return {
        text: `${requester}Plan 확인과 제출을 기다립니다`,
        since: sinceStatus(events, 'REVIEWING'),
        leaves: [plan ?? root.id],
        mode: 'wait',
      }
    case 'REAPPROVAL_REQUIRED':
      return {
        text: `Plan이 바뀌어 ${requester}다시 제출을 기다립니다`,
        since: sinceStatus(events, 'REAPPROVAL_REQUIRED'),
        leaves: [plan ?? root.id],
        mode: 'wait',
      }
    case 'PENDING_APPROVAL':
      return waitingForApproval(root, sinceStatus(events, 'PENDING_APPROVAL'), request?.currentPlan)
    case 'RUNNING':
    case 'ROLLING_BACK':
      return running(root, gateReplaying)
    case 'VERIFICATION_FAILED': {
      const reasons = (request?.failedChecks ?? []).map((code) => FAILED_CHECK_SHORT[code] ?? code).join(', ')
      return { text: reasons ? `웹쉘이 실행을 거부했습니다: ${reasons}` : '웹쉘이 실행을 거부했습니다', leaves: [GATE_ID], mode: 'failed' }
    }
    case 'REJECTED': {
      const leaves = tasks.filter((task) => task.status === 'REJECTED').map((task) => task.id)
      const rejection = request?.rejection
      return {
        text: rejection ? `${josa(rejection.by, '이', '가')} 요청을 거부했습니다: ${rejection.reason}` : '요청이 거부되었습니다',
        leaves,
        mode: leaves.length > 0 ? 'failed' : null,
      }
    }
    case 'CANCELED':
      return { text: '요청이 취소되었습니다', leaves: [], mode: null }
    case 'KILLED': {
      const leaves = tasks.flatMap((task) => stepsOf(task).filter((step) => step.status === 'SKIPPED').map((step) => step.id))
      const kill = request?.kill
      return {
        text: kill ? `${josa(kill.by, '이', '가')} 킬 스위치로 중단했습니다: ${kill.reason}` : '킬 스위치로 중단했습니다',
        leaves,
        mode: leaves.length > 0 ? 'failed' : null,
      }
    }
    case 'COMPLETED': {
      const done = tasks.filter((task) => task.status === 'SUCCEEDED').length
      const excluded = countForbidden(tasks)
      if (excluded > 0) {
        const finished = done > 0 ? `실행 대상 작업 ${done}개를 끝냈습니다` : '요청이 끝났습니다'
        return { text: `${finished}. ${forbiddenExcludedText(excluded)}`, leaves: [], mode: null }
      }
      return { text: done > 0 ? `작업 ${done}개를 모두 끝냈습니다` : '요청이 끝났습니다', leaves: [], mode: null }
    }
    case 'PARTIALLY_COMPLETED': {
      const done = tasks.filter((task) => task.status === 'SUCCEEDED').length
      const excluded = countForbidden(tasks)
      const forbiddenNote = excluded > 0 ? `. ${forbiddenExcludedText(excluded)}` : ''
      return {
        text: `${firstFailed ? `${josa(title(firstFailed), '이', '가')} 실패했습니다. 앞선 작업 ${done}개는 끝났습니다` : '일부 작업만 끝났습니다'}${forbiddenNote}`,
        leaves: failedLeaves(root),
        mode: 'failed',
      }
    }
    case 'FAILED':
      return {
        text: firstFailed ? `${josa(title(firstFailed), '이', '가')} 실패했습니다` : '실행에 실패했습니다',
        leaves: failedLeaves(root),
        mode: 'failed',
      }
    case 'ROLLED_BACK':
      return { text: '문서를 이전 버전으로 되돌렸습니다', leaves: [], mode: null }
    case 'ROLLBACK_FAILED':
      return { text: '문서를 되돌리지 못했습니다', leaves: failedLeaves(root), mode: 'failed' }
    default:
      // 서버가 새 상태를 보내도 화면이 깨지지 않게 한다. 알지 못하는 상태를 설명하지 않는다.
      return { text: '요청 상태를 확인해 주세요', leaves: [], mode: null }
  }
}

/** 요청에서 끝 노드까지 지나는 노드들. 실행 단계와 관문은 작업의 자식이 아니어도 관문을 지나 이어진다. */
export function pathIds(root: ProgressRequestNode, leaves: string[]): Set<string> {
  const ids = new Set<string>()
  if (leaves.length === 0) return ids
  const plan = currentPlanId(root)
  const add = (...items: Array<string | undefined>) => items.forEach((id) => id && ids.add(id))
  for (const leaf of leaves) add(root.id, leaf === root.id ? undefined : leaf)
  if (leaves.includes(GATE_ID)) {
    add(plan)
    for (const task of tasksOf(root)) if (task.status !== 'BLOCKED') add(task.id)
  }
  for (const task of tasksOf(root)) {
    const children: ProgressNode[] = task.children
    for (const child of children) {
      if (!leaves.includes(child.id)) continue
      add(plan, task.id)
      if (child.type === 'STEP') add(GATE_ID)
    }
    if (leaves.includes(task.id)) add(plan)
  }
  return ids
}
