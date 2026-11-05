import type { RequestStatus, Task } from '../../api/types'
import { REQUEST_STATUS_LABEL, labelOf } from '../../lib/labels'

/** 승인 대기가 아니면 결정 버튼을 눌러도 아무 일이 없으므로 내놓지 않는다. */
export function isDecisionClosed(status: RequestStatus): boolean {
  return status !== 'PENDING_APPROVAL'
}

/** 결정 칸 자리에 쓰는 끝난 상태. 문서만 있는 요청의 거부는 화면에서 "미적용"이라고 부른다. */
export function closedDecisionText(status: RequestStatus, tasks: Array<Pick<Task, 'type'>>): string {
  if (status === 'REJECTED') return tasks.length > 0 && tasks.every((task) => task.type === 'DOC') ? '미적용으로 처리했습니다' : '거부된 요청입니다'
  return `${labelOf(REQUEST_STATUS_LABEL, status)} 상태라 더 결정할 것이 없습니다`
}
