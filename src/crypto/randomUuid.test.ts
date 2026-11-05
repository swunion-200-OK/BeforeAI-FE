import { describe, expect, it } from 'vitest'
import { randomUuid } from './randomUuid'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('randomUuid', () => {
  it('보안 컨텍스트가 아니라 randomUUID가 없어도 UUID v4를 만든다', () => {
    const insecure = { getRandomValues: crypto.getRandomValues.bind(crypto) }
    const ids = new Set(Array.from({ length: 20 }, () => randomUuid(insecure)))
    expect(ids.size).toBe(20)
    for (const id of ids) expect(id).toMatch(UUID_V4)
  })

  it('있으면 브라우저 구현을 쓴다', () => {
    expect(randomUuid()).toMatch(UUID_V4)
  })
})
