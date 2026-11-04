import type { RequestStatus } from '../../api/types'

/** 숫자 카드의 "확인 필요"와 상태별 건수의 묶음이 같아야 두 합이 어긋나지 않는다. */
export const ATTENTION_STATUSES: RequestStatus[] = [
  'VERIFICATION_FAILED',
  'ANALYSIS_FAILED',
  'FAILED',
  'ROLLBACK_FAILED',
  'REAPPROVAL_REQUIRED',
  // 실패한 작업을 재시도해야 하므로 끝난 요청이 아니라 확인할 요청이다.
  'PARTIALLY_COMPLETED',
]
