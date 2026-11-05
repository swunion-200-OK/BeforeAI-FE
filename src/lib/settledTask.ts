import type { ProgressNode, ProgressRequestNode, RequestStatus, TaskStatus } from '../api/types'

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

function settleNode(node: ProgressNode, requestStatus: RequestStatus): ProgressNode {
  if (node.type === 'APPROVAL' || node.type === 'STEP') return node
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
