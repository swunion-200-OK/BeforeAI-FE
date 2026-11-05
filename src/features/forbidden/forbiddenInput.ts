import type { ForbiddenInput } from '../../api/endpoints'

export const EMPTY_FORBIDDEN_INPUT: ForbiddenInput = { taskType: 'DEPLOY', target: '', reason: '' }

export function isForbiddenInputComplete(value: ForbiddenInput): boolean {
  return Boolean(value.target.trim() && value.reason.trim())
}

/** 규칙 추가 버튼이 잠긴 진짜 이유. 부서가 없는데 입력을 채우라고 하면 눌러도 아무 일이 없는 것처럼 보인다. */
export function addRuleBlockedReason({
  departmentsPending,
  departmentsFailed,
  hasDepartment,
  inputComplete,
}: {
  departmentsPending: boolean
  departmentsFailed: boolean
  hasDepartment: boolean
  inputComplete: boolean
}): string | null {
  if (departmentsPending) return '부서 목록을 불러오는 중입니다'
  if (departmentsFailed) return '부서 목록을 불러오지 못했습니다. 다시 열어 주세요'
  if (!hasDepartment) return '규칙을 걸 부서가 없습니다. 계정·권한에서 부서를 먼저 만들어 주세요'
  return inputComplete ? null : '대상과 사유를 입력해 주세요'
}
