import type { ForbiddenInput } from '../../api/endpoints'

export const EMPTY_FORBIDDEN_INPUT: ForbiddenInput = { taskType: 'DEPLOY', target: '', reason: '' }

export function isForbiddenInputComplete(value: ForbiddenInput): boolean {
  return Boolean(value.target.trim() && value.reason.trim())
}
