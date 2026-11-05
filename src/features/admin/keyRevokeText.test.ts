import { describe, expect, it } from 'vitest'
import { revokeConfirmText, revokedToast } from './keyRevokeText'

describe('키 폐기 안내', () => {
  it('정책이 있으면 새 정책으로 반영했다고 한다', () => {
    expect(revokedToast('김담당', 'REGISTERED', 'exists')).toContain('새 정책으로 웹쉘에 반영')
  })

  it('프리셋 적용 전이면 웹쉘에 보내지 않았다고 한다', () => {
    expect(revokedToast('김담당', 'REGISTERED', 'none')).toContain('웹쉘에 보낸 정책은 없습니다')
    expect(revokeConfirmText('REGISTERED', 'none')).toContain('키 상태만 바뀝니다')
  })

  it('등록 대기 키와 정책을 모를 때는 폐기한 사실만 말한다', () => {
    expect(revokedToast('김담당', 'PENDING', 'exists')).toBe('김담당님의 승인 키를 폐기했습니다')
    expect(revokedToast('김담당', 'REGISTERED', 'unknown')).toBe('김담당님의 승인 키를 폐기했습니다')
    expect(revokeConfirmText('PENDING', 'exists')).toContain('등록 전 키')
  })
})
