import { describe, expect, it } from 'vitest'
import { restoredFromText } from './specView'

describe('기획서 복원 표시', () => {
  it('서버가 값을 빼면 복원본이 아니다', () => {
    expect(restoredFromText({})).toBeNull()
    expect(restoredFromText({ restoredFromVersion: null })).toBeNull()
  })

  it('복원본이면 원본 버전을 말한다', () => {
    expect(restoredFromText({ restoredFromVersion: 1 })).toBe('v1에서 복원')
  })
})
