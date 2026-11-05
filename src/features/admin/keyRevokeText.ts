import type { SigningKeyStatus } from '../../api/types'

/** exists: 적용된 정책이 있다, none: 프리셋 적용 전이라 정책이 없다, unknown: 아직 모른다 */
export type PolicyState = 'exists' | 'none' | 'unknown'

/**
 * 폐기의 웹쉘 반영 (서버 SigningKeyCommandService.revoke): 등록된 키는 정책이 있으면 새 정책 버전을 배포하고,
 * 프리셋 적용 전이면 키 상태만 바뀐다. 등록 대기 키는 웹쉘 정책에 들어간 적이 없다.
 */
export function revokedToast(owner: string, status: SigningKeyStatus, policy: PolicyState): string {
  const done = `${owner}님의 승인 키를 폐기했습니다`
  if (status !== 'REGISTERED' || policy === 'unknown') return done
  return policy === 'exists' ? `${done}. 새 정책으로 웹쉘에 반영했습니다` : `${done}. 적용된 프리셋이 없어 웹쉘에 보낸 정책은 없습니다`
}

export function revokeConfirmText(status: SigningKeyStatus | undefined, policy: PolicyState): string {
  if (status !== 'REGISTERED') return '아직 등록 전 키라 웹쉘 정책에는 들어 있지 않습니다.'
  if (policy === 'none') return '적용된 프리셋이 없어 키 상태만 바뀝니다. 이후 만드는 정책에는 이 키가 들어가지 않습니다.'
  return '새 정책으로 웹쉘에 반영되어 이 키의 서명은 더 이상 검증을 통과하지 못합니다.'
}
