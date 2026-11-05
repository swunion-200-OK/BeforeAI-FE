import { describe, expect, it } from 'vitest'
import { isSendKey } from './enterToSend'

const key = (overrides: Partial<Parameters<typeof isSendKey>[0]> = {}) => ({
  key: 'Enter',
  shiftKey: false,
  altKey: false,
  repeat: false,
  keyCode: 13,
  nativeEvent: { isComposing: false },
  ...overrides,
})

describe('isSendKey', () => {
  it('Enter만 누르면 보낸다', () => {
    expect(isSendKey(key())).toBe(true)
  })

  it('Shift+Enter는 줄바꿈으로 남긴다', () => {
    expect(isSendKey(key({ shiftKey: true }))).toBe(false)
  })

  it('한글 조합 중에는 보내지 않는다', () => {
    expect(isSendKey(key({ nativeEvent: { isComposing: true } }))).toBe(false)
    expect(isSendKey(key({ keyCode: 229 }))).toBe(false)
  })

  it('누르고 있어 반복되는 Enter는 보내지 않는다', () => {
    expect(isSendKey(key({ repeat: true }))).toBe(false)
  })

  it('다른 키는 보내지 않는다', () => {
    expect(isSendKey(key({ key: 'a' }))).toBe(false)
  })
})
