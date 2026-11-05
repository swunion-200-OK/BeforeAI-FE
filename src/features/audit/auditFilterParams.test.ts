import { describe, expect, it } from 'vitest'
import { countFilters } from './auditFilterParams'

describe('countFilters', () => {
  it('적용되는 조건만 센다', () => {
    expect(countFilters(new URLSearchParams(''))).toBe(0)
    expect(countFilters(new URLSearchParams('network=EXTERNAL&from=2026-11-01'))).toBe(2)
  })

  it('날짜가 아닌 값은 적용되지 않으므로 세지 않는다', () => {
    expect(countFilters(new URLSearchParams('from=garbage&to=nope'))).toBe(0)
    expect(countFilters(new URLSearchParams('from=garbage&network=INTERNAL'))).toBe(1)
  })
})
