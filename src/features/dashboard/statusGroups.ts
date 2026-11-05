import type { RequestStatus } from '../../api/types'
import { STATUS_GROUPS } from '../requests/requestPaths'

/** 숫자 카드의 "확인 필요"는 목록 탭의 묶음을 그대로 쓴다. 따로 두면 두 숫자가 어긋난다. */
export const ATTENTION_STATUSES: RequestStatus[] = STATUS_GROUPS.find((group) => group.id === 'attention')?.statuses ?? []
