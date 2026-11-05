import { afterEach, describe, expect, it, vi } from 'vitest'
import { countFilters, isRequestIdFilter } from './auditFilterParams'

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

describe('요청 ID 필터', () => {
  const REQUEST_ID = '3cc84fb8-1b2c-4d3e-8f90-0123456789ab'

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('실제 서버에는 UUID만 보낼 수 있다', () => {
    expect(isRequestIdFilter(REQUEST_ID, false)).toBe(true)
    expect(isRequestIdFilter('r-main', false)).toBe(false)
    expect(isRequestIdFilter('garbage', false)).toBe(false)
  })

  it('목의 요청 ID는 UUID가 아니어도 시연처럼 걸러진다', () => {
    expect(isRequestIdFilter('r-main', true)).toBe(true)
  })

  it('실제 서버 모드에서 형식이 틀린 값은 요청에 싣지 않고 조건으로 세지 않는다', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_API_BASE_URL', '/api/v1')
    const real = await import('./auditFilterParams')
    expect(real.toAuditQuery(new URLSearchParams('requestId=garbage')).requestId).toBeUndefined()
    expect(real.countFilters(new URLSearchParams('requestId=garbage'))).toBe(0)
    expect(real.toAuditQuery(new URLSearchParams(`requestId=${REQUEST_ID}`)).requestId).toBe(REQUEST_ID)
    expect(real.countFilters(new URLSearchParams(`requestId=${REQUEST_ID}`))).toBe(1)
    // 주소로 들어온 다른 ID 조건도 서버는 400으로 답한다.
    expect(real.toAuditQuery(new URLSearchParams('actorId=a&departmentId=b&projectId=c'))).toMatchObject({ actorId: undefined, departmentId: undefined, projectId: undefined })
    expect(real.countFilters(new URLSearchParams('actorId=a&departmentId=b&projectId=c'))).toBe(0)
  })
})
