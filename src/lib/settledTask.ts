import type { ProgressNode, ProgressRequestNode, ProgressTaskNode, RequestStatus, TaskStatus } from '../api/types'

/** 더 이상 승인을 받지 않는 요청 상태. 재승인이나 다시 제출을 기다리는 상태는 넣지 않는다. */
const ENDED: readonly string[] = [
  'ANALYSIS_FAILED',
  'REJECTED',
  'CANCELED',
  'KILLED',
  'COMPLETED',
  'PARTIALLY_COMPLETED',
  'FAILED',
  'ROLLED_BACK',
  'ROLLBACK_FAILED',
] satisfies RequestStatus[]

export function isRequestEnded(status: RequestStatus): boolean {
  return ENDED.includes(status)
}

/**
 * 서버는 취소나 거부된 요청의 작업을 PENDING으로 둔다. 끝난 요청의 작업은 승인을 기다리지 않으므로
 * "승인 대기"라고 하지 않고 실행되지 않았다고 보여 준다.
 */
export function shownTaskStatus(status: TaskStatus, requestStatus: RequestStatus | undefined): TaskStatus {
  return status === 'PENDING' && requestStatus !== undefined && isRequestEnded(requestStatus) ? 'SKIPPED' : status
}

export const INTERRUPTED_WORD = '중단됨'

/** 실행 단계가 있는데 건너뛴 작업은 시작했다가 킬 스위치로 멈춘 것이다. 시작 전 작업에는 단계가 없다. */
export function isInterruptedTask(task: Pick<ProgressTaskNode, 'status' | 'children'>): boolean {
  return task.status === 'SKIPPED' && task.children.some((child) => child.type === 'STEP')
}

/** 서버 작업 ID로 돌려준다. 트리 노드 ID는 task:{작업 id}다. */
export function interruptedTaskIds(root: ProgressRequestNode): Set<string> {
  const ids = new Set<string>()
  for (const plan of root.children) {
    if (plan.type !== 'PLAN' || plan.status !== 'CURRENT') continue
    for (const task of plan.children) {
      if (task.type === 'TASK' && isInterruptedTask(task)) ids.add(task.id.replace(/^task:/, ''))
    }
  }
  return ids
}

function settleNode(node: ProgressNode, requestStatus: RequestStatus): ProgressNode {
  // 서버는 멈춘 단계를 RUNNING으로 둔다 (종료 이벤트가 오지 않는다). 중단된 요청에서 실행 중이라고 하지 않는다.
  if (node.type === 'STEP') return requestStatus === 'KILLED' && node.status === 'RUNNING' ? { ...node, status: 'SKIPPED' } : node
  if (node.type === 'APPROVAL') return node
  const children = node.children
    .filter((child) => !(child.type === 'APPROVAL' && child.status === 'PENDING'))
    .map((child) => settleNode(child, requestStatus))
  if (node.type !== 'TASK') return { ...node, children }
  return { ...node, status: shownTaskStatus(node.status, requestStatus), children }
}

/** 진행 트리도 같다. 끝난 요청이면 승인 대기 노드를 치우고 작업 상태를 맞춘다. 트리는 스트림으로 상태만 바뀌므로 화면에서 계산한다. */
export function settleProgressRoot(root: ProgressRequestNode): ProgressRequestNode {
  return isRequestEnded(root.status) ? (settleNode(root, root.status) as ProgressRequestNode) : root
}
