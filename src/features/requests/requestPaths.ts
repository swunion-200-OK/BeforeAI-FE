import type { RequestDetail, RequestStatus, RequestSummary, Task, TaskApprovalStatus } from '../../api/types'
import { isRequestEnded } from '../../lib/settledTask'

const COMPOSE: RequestStatus[] = ['ANALYZING', 'REVIEWING', 'ANALYSIS_FAILED']

/** 제출 전 요청은 Plan 검토 화면으로 간다. 그 화면은 내부망 전용이라 외부망은 요청 상세로 보낸다. */
export function pathFor(request: Pick<RequestSummary, 'id' | 'status'>, external: boolean) {
  return COMPOSE.includes(request.status) && !external ? `/requests/new/${request.id}` : `/requests/${request.id}`
}

export interface StatusGroup {
  id: 'progress' | 'waiting' | 'attention' | 'done'
  label: string
  statuses: RequestStatus[]
}

/** 목록 탭의 상태 묶음. 지금 내가 봐야 할 것을 기준으로 나눴다. */
export const STATUS_GROUPS: StatusGroup[] = [
  { id: 'progress', label: '진행 중', statuses: ['ANALYZING', 'REVIEWING', 'RUNNING', 'ROLLING_BACK'] },
  { id: 'waiting', label: '승인 대기', statuses: ['PENDING_APPROVAL', 'REAPPROVAL_REQUIRED'] },
  {
    id: 'attention',
    label: '확인 필요',
    statuses: ['ANALYSIS_FAILED', 'VERIFICATION_FAILED', 'PARTIALLY_COMPLETED', 'FAILED', 'ROLLBACK_FAILED'],
  },
  { id: 'done', label: '끝남', statuses: ['COMPLETED', 'ROLLED_BACK', 'REJECTED', 'CANCELED', 'KILLED'] },
]

/**
 * 승인대기인데 승인이 다 모였는지. 그러면 웹쉘에 연결되지 않아 실행이 시작되지 못한 것이다 (서버 ApprovalService.approve).
 * 서버가 알려 주는 작업 상태로 판단한다. 승인된 작업이 하나도 없으면 "모두 모였다"고 말하지 않는다.
 */
export function allApprovalsCollected(request: Pick<RequestDetail, 'status' | 'currentPlan'>): boolean {
  const tasks = request.currentPlan?.tasks ?? []
  return (
    request.status === 'PENDING_APPROVAL' &&
    tasks.some((task) => task.status === 'APPROVED') &&
    !tasks.some((task) => task.status === 'PENDING')
  )
}

/** 제출 전이나 승인을 받지 않고 끝난 작업에는 승인 현황을 그리지 않는다. */
export function approvalToShow(
  statuses: TaskApprovalStatus[],
  request: Pick<RequestDetail, 'status'>,
  task: Task,
): TaskApprovalStatus | undefined {
  const status = statuses.find((item) => item.taskId === task.id)
  if (!status || request.status === 'REVIEWING') return undefined
  // 끝난 요청의 PENDING 작업은 더 이상 승인을 기다리지 않는다.
  if (task.status === 'PENDING' && isRequestEnded(request.status)) return undefined
  const hasRecords = status.requirements.some((requirement) => requirement.approvedBy.length > 0)
  const waiting = request.status === 'PENDING_APPROVAL' || request.status === 'REAPPROVAL_REQUIRED'
  return hasRecords || (waiting && task.status === 'PENDING') ? status : undefined
}
