import type { RequestStatus, RequestSummary } from '../../api/types'

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
