import type { Plan, RequestStatus } from '../../api/types'
import { REQUEST_STATUS_LABEL, labelOf } from '../../lib/labels'

/** 문서 롤백을 걸 수 있는 요청 상태 (서버 RequestRollbackService.ROLLBACKABLE) */
export const ROLLBACK_ALLOWED: RequestStatus[] = ['COMPLETED', 'PARTIALLY_COMPLETED', 'KILLED', 'ROLLBACK_FAILED']

/**
 * 프로젝트가 없으면 문서 조회가 꺼져 있어 isPending이 계속 true다. 그때는 기다리지 않는다.
 */
export function isDocumentsLoading({ projectsPending, projectCount, documentsPending }: { projectsPending: boolean; projectCount: number; documentsPending: boolean }): boolean {
  return projectsPending || (projectCount > 0 && documentsPending)
}

/**
 * 롤백에 보낼 작업. 서버는 요청의 DOC 작업 target(경로)으로 문서를 찾고, 같은 경로의 작업을 함께 받지 않는다.
 * 그래서 이 문서를 가리키는 작업 중 마지막 하나만 보낸다. 서버 상세에는 지금 Plan만 있어 지난 Plan의 작업은 찾지 못한다.
 */
export function rollbackTaskIds(plan: Pick<Plan, 'tasks'> | null | undefined, documentPath: string): string[] {
  const matching = (plan?.tasks ?? []).filter((task) => task.type === 'DOC' && task.target === documentPath)
  const last = matching.reduce<(typeof matching)[number] | null>((found, task) => (found && found.order > task.order ? found : task), null)
  return last ? [last.id] : []
}

/** 눌러 보기 전에 왜 안 되는지 알려 준다. 작업 ID는 요청 상세에서만 알 수 있어 그 요청을 볼 수 있어야 한다. */
export function rollbackBlockedReason({
  appliedBy,
  requestPending,
  requestStatus,
  taskIds,
}: {
  appliedBy: string | null
  requestPending: boolean
  requestStatus: RequestStatus | undefined
  taskIds: string[]
}): string | null {
  if (!appliedBy) return '이 문서를 적용한 요청이 없어 되돌릴 수 없습니다'
  if (requestPending) return '이 문서를 적용한 요청을 확인하는 중입니다'
  if (requestStatus === undefined) return '이 문서를 적용한 요청을 볼 수 없어 되돌릴 수 없습니다'
  if (!ROLLBACK_ALLOWED.includes(requestStatus)) {
    return `이 문서를 마지막으로 적용한 요청이 ${labelOf(REQUEST_STATUS_LABEL, requestStatus)} 상태라 롤백할 수 없습니다`
  }
  return taskIds.length === 0 ? '이 문서를 적용한 작업을 찾지 못해 되돌릴 수 없습니다' : null
}
