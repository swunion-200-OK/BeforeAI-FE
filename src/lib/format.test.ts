import { describe, expect, it } from 'vitest'
import { formatDateTime, formatElapsed } from './format'

describe('시각 표시', () => {
  it('시각이 없거나 잘못되어도 화면을 깨지 않는다', () => {
    const missing = undefined as unknown as string
    expect(formatDateTime(missing)).toBe('-')
    expect(formatDateTime('not-a-date')).toBe('-')
    expect(formatElapsed(missing)).toBe('-')
    expect(formatElapsed('not-a-date')).toBe('-')
  })

  it('올바른 시각은 그대로 읽는다', () => {
    const now = new Date('2026-11-05T12:00:00Z')
    expect(formatDateTime('2026-11-05T11:00:00Z', now)).toMatch(/^오늘 /)
    expect(formatElapsed('2026-11-05T11:30:00Z', now.getTime())).toBe('30분')
  })
})
