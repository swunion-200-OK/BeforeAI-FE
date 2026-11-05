// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiError } from './errors'

type Client = typeof import('./client')
type Call = { url: string; init: RequestInit }
type Reply = Response | Error | (() => Response | Promise<Response>)

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
const unauthorized = () => json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } })
const token = (accessToken: string, headers: Record<string, string> = {}) => json(200, { accessToken }, headers)

/** 경로별로 준비한 답을 차례로 돌려주는 가짜 전송 계층. 모듈 상태(토큰·재발급)가 시험마다 새로 시작하게 다시 불러온다. */
async function setup(handler: (call: Call, calls: Call[]) => Reply) {
  vi.resetModules()
  const client: Client = await import('./client')
  const calls: Call[] = []
  client.setTransport(async (url, init) => {
    const call = { url, init }
    calls.push(call)
    const reply = handler(call, calls)
    if (reply instanceof Error) throw reply
    return typeof reply === 'function' ? reply() : reply
  })
  const expired = vi.fn()
  client.setSessionExpiredHandler(expired)
  const count = (path: string) => calls.filter((call) => call.url.endsWith(path)).length
  const authHeader = (call: Call) => (call.init.headers as Record<string, string>).Authorization
  return { client, calls, expired, count, authHeader }
}

beforeEach(() => {
  vi.stubGlobal('navigator', undefined)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('새로고침 후 세션 복원', () => {
  it('StrictMode처럼 두 번 불러도 재발급은 한 번만 보내고 토큰을 복원한다', async () => {
    const t = await setup((call) => (call.url.endsWith('/auth/refresh') ? token('T1') : json(200, { ok: true })))
    const [first, second] = await Promise.all([t.client.restoreSession(), t.client.restoreSession()])
    expect([first, second]).toEqual([true, true])
    expect(await t.client.restoreSession()).toBe(true)
    expect(t.count('/auth/refresh')).toBe(1)
    await t.client.http('GET', '/me')
    expect(t.authHeader(t.calls.at(-1) as Call)).toBe('Bearer T1')
  })

  it('쿠키가 없으면 false로 끝나고 만료 알림을 내지 않는다', async () => {
    const t = await setup(() => unauthorized())
    expect(await t.client.restoreSession()).toBe(false)
    expect(t.expired).not.toHaveBeenCalled()
  })

  it.each([
    ['연결 실패', () => new TypeError('Failed to fetch')],
    ['프록시의 HTML', () => new Response('<html></html>', { status: 200 })],
    ['토큰 없는 200', () => json(200, {})],
  ])('%s도 false로 끝나고 만료 알림을 내지 않는다', async (_name, reply) => {
    const t = await setup(() => reply())
    expect(await t.client.restoreSession()).toBe(false)
    expect(t.expired).not.toHaveBeenCalled()
  })

  it.each([
    ['연결 실패', () => new TypeError('Failed to fetch'), true],
    ['빈 502', () => new Response('', { status: 502 }), true],
    ['프록시의 HTML', () => new Response('<html></html>', { status: 200 }), true],
    ['서버의 거부', () => unauthorized(), false],
    ['토큰 없는 200', () => json(200, {}), false],
  ])('%s: 서버에 닿지 못한 것인지 구분한다', async (_name, reply, unreachable) => {
    const t = await setup(() => reply())
    await t.client.restoreSession()
    expect(t.client.isSessionUnreachable()).toBe(unreachable)
  })

  it('서버가 돌아오면 다시 시도해 세션을 잇는다', async () => {
    let down = true
    const t = await setup(() => (down ? new TypeError('Failed to fetch') : token('T1')))
    expect(await t.client.restoreSession()).toBe(false)
    down = false
    expect(await t.client.retryRestoreSession()).toBe(true)
    expect(t.client.isSessionUnreachable()).toBe(false)
    expect(t.count('/auth/refresh')).toBe(2)
  })

  it('쓰던 중 재발급이 서버에 닿지 못하면 세션을 끝내지 않는다', async () => {
    let refreshDown = false
    const t = await setup((call) => {
      if (!call.url.endsWith('/auth/refresh')) return unauthorized()
      return refreshDown ? new TypeError('Failed to fetch') : token('T1')
    })
    await t.client.restoreSession()
    refreshDown = true
    const response = await t.client.rawFetch('GET', '/me')
    expect(response.status).toBe(401)
    expect(t.expired).not.toHaveBeenCalled()
  })

  it('복원 중 나간 요청은 기다렸다가 새 토큰으로 보낸다', async () => {
    let finish: (response: Response) => void = () => {}
    const t = await setup((call) =>
      call.url.endsWith('/auth/refresh') ? () => new Promise<Response>((resolve) => (finish = resolve)) : json(200, {}),
    )
    const restoring = t.client.restoreSession()
    const request = t.client.http('GET', '/me')
    await Promise.resolve()
    expect(t.count('/me')).toBe(0)
    finish(token('T1'))
    await Promise.all([restoring, request])
    expect(t.authHeader(t.calls.at(-1) as Call)).toBe('Bearer T1')
  })

  it('응답 없는 재발급에 갇히지 않게 시간 제한을 건다', async () => {
    const t = await setup(() => token('T1'))
    await t.client.restoreSession()
    expect(t.calls[0].init.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('401과 재발급', () => {
  it('동시에 401이 나도 재발급은 한 번이고, 모두 새 토큰으로 다시 보낸다', async () => {
    const t = await setup((call) => {
      if (call.url.endsWith('/auth/refresh')) return token('T2')
      return (call.init.headers as Record<string, string>).Authorization === 'Bearer T2' ? json(200, { ok: 1 }) : unauthorized()
    })
    t.client.setAccessToken('T1')
    const results = await Promise.all([t.client.http('GET', '/a'), t.client.http('GET', '/b'), t.client.http('GET', '/c')])
    expect(results).toEqual([{ ok: 1 }, { ok: 1 }, { ok: 1 }])
    expect(t.count('/auth/refresh')).toBe(1)
    expect(t.expired).not.toHaveBeenCalled()
  })

  it('이미 재발급이 끝난 뒤 도착한 옛 토큰의 401은 재발급 없이 다시 보낸다', async () => {
    let lateReply: (response: Response) => void = () => {}
    const t = await setup((call) => {
      if (call.url.endsWith('/auth/refresh')) return token('T2')
      if (call.url.endsWith('/slow') && t2Sent(call) === false) return () => new Promise<Response>((resolve) => (lateReply = resolve))
      return t2Sent(call) ? json(200, { ok: 1 }) : unauthorized()
    })
    function t2Sent(call: Call) {
      return (call.init.headers as Record<string, string>).Authorization === 'Bearer T2'
    }
    t.client.setAccessToken('T1')
    const slow = t.client.http('GET', '/slow')
    await t.client.http('GET', '/fast')
    expect(t.count('/auth/refresh')).toBe(1)
    lateReply(unauthorized())
    expect(await slow).toEqual({ ok: 1 })
    expect(t.count('/auth/refresh')).toBe(1)
  })

  it('다시 보낸 요청의 성공 응답을 돌려주고 그 X-Network를 읽는다', async () => {
    const t = await setup((call, calls) => {
      if (call.url.endsWith('/auth/refresh')) return token('T2', { 'X-Network': 'INTERNAL' })
      return calls.length === 1 ? unauthorized() : json(200, { ok: 1 }, { 'X-Network': 'EXTERNAL' })
    })
    t.client.setAccessToken('T1')
    const seen: Array<string | null> = []
    t.client.networkStore.subscribe(() => seen.push(t.client.networkStore.get()))
    expect(await t.client.http('GET', '/a')).toEqual({ ok: 1 })
    expect(seen).toEqual(['INTERNAL', 'EXTERNAL'])
  })

  it('재발급 뒤에도 401이면 되풀이하지 않고 세션을 끝낸다', async () => {
    const t = await setup((call) => (call.url.endsWith('/auth/refresh') ? token('T2') : unauthorized()))
    t.client.setAccessToken('T1')
    await expect(t.client.http('GET', '/a')).rejects.toMatchObject({ status: 401 })
    expect(t.count('/auth/refresh')).toBe(1)
    expect(t.count('/a')).toBe(2)
    expect(t.expired).toHaveBeenCalledTimes(1)
  })

  it('재발급이 실패하면 동시 요청이 여럿이어도 만료 알림은 한 번이다', async () => {
    const t = await setup(() => unauthorized())
    t.client.setAccessToken('T1')
    const results = await Promise.allSettled([t.client.http('GET', '/a'), t.client.http('GET', '/b')])
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected'])
    expect(t.count('/auth/refresh')).toBe(1)
    expect(t.expired).toHaveBeenCalledTimes(1)
  })

  it('토큰 없이 보낸 요청의 401은 재발급하지 않는다', async () => {
    const t = await setup(() => unauthorized())
    await expect(t.client.http('GET', '/a')).rejects.toMatchObject({ status: 401 })
    expect(t.count('/auth/refresh')).toBe(0)
    expect(t.expired).not.toHaveBeenCalled()
  })

  it('응답을 기다리는 사이 로그아웃했으면 401이 와도 세션을 되살리지 않는다', async () => {
    let reply: (response: Response) => void = () => {}
    const t = await setup(() => () => new Promise<Response>((resolve) => (reply = resolve)))
    t.client.setAccessToken('T1')
    const request = t.client.http('GET', '/a')
    await Promise.resolve()
    t.client.setAccessToken(null)
    reply(unauthorized())
    await expect(request).rejects.toMatchObject({ status: 401 })
    expect(t.count('/auth/refresh')).toBe(0)
  })

  it('재발급 중 로그아웃하면 그 결과를 버린다', async () => {
    let refreshed: (response: Response) => void = () => {}
    const t = await setup((call) =>
      call.url.endsWith('/auth/refresh') ? () => new Promise<Response>((resolve) => (refreshed = resolve)) : unauthorized(),
    )
    t.client.setAccessToken('T1')
    const request = t.client.http('GET', '/a')
    await vi.waitFor(() => expect(t.count('/auth/refresh')).toBe(1))
    t.client.setAccessToken(null)
    refreshed(token('T2'))
    await expect(request).rejects.toMatchObject({ status: 401 })
    await t.client.http('GET', '/b').catch(() => {})
    expect(t.authHeader(t.calls.at(-1) as Call)).toBeUndefined()
  })
})

describe('로그아웃', () => {
  it('토큰이 만료됐으면 재발급 후 다시 보내 쿠키를 지우게 한다', async () => {
    const t = await setup((call, calls) => {
      if (call.url.endsWith('/auth/refresh')) return token('T2')
      return calls.filter((c) => c.url.endsWith('/auth/logout')).length === 1 ? unauthorized() : new Response(null, { status: 204 })
    })
    t.client.setAccessToken('T1')
    await t.client.logout()
    expect(t.count('/auth/logout')).toBe(2)
    expect(t.authHeader(t.calls.at(-1) as Call)).toBe('Bearer T2')
    expect(t.expired).not.toHaveBeenCalled()
  })

  it('쿠키가 이미 죽었으면 그대로 끝난다', async () => {
    const t = await setup(() => unauthorized())
    t.client.setAccessToken('T1')
    await expect(t.client.logout()).resolves.toBeUndefined()
    expect(t.count('/auth/logout')).toBe(1)
  })
})

describe('기본 전송 계층', () => {
  it.each([
    ['재발급', (client: Client) => client.restoreSession()],
    ['로그아웃', (client: Client) => client.logout()],
    ['일반 요청', (client: Client) => client.http('GET', '/me')],
  ])('%s도 쿠키를 싣는다', async (_name, run) => {
    vi.resetModules()
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => json(200, { accessToken: 'T1' }))
    vi.stubGlobal('fetch', fetchMock)
    const client: Client = await import('./client')
    await run(client)
    expect(fetchMock.mock.calls[0][1].credentials).toBe('include')
  })
})

describe('연결 실패와 이상한 응답', () => {
  it('fetch의 TypeError를 읽을 수 있는 한국어 오류로 바꾼다', async () => {
    const t = await setup(() => new TypeError('Failed to fetch'))
    const error = await t.client.http('GET', '/a').catch((reason: unknown) => reason)
    expect(error).toMatchObject({ name: 'ApiError', status: 0, code: 'NETWORK_ERROR' })
    expect((error as ApiError).message).toContain('서버에 연결하지 못했습니다')
    expect(t.client.isTransientError(error)).toBe(true)
  })

  it('중단은 오류로 바꾸지 않는다', async () => {
    const aborted = new DOMException('Aborted', 'AbortError')
    const t = await setup(() => aborted)
    await expect(t.client.http('GET', '/a')).rejects.toBe(aborted)
  })

  it.each([
    [502, '<html>Bad Gateway</html>'],
    [502, ''],
    [503, 'upstream down'],
    [504, ''],
  ])('%i와 JSON이 아닌 본문 %j는 일시 오류로 읽는다', async (status, body) => {
    const t = await setup(() => new Response(body, { status }))
    const error = await t.client.http('GET', '/a').catch((reason: unknown) => reason)
    expect(error).toMatchObject({ status, code: 'UNKNOWN' })
    expect((error as ApiError).message).toBe(`서버에 일시적인 문제가 있습니다. 잠시 후 다시 시도해 주세요 (${status})`)
    expect(t.client.isTransientError(error)).toBe(true)
  })

  it('Spring 기본 오류처럼 error가 문자열이어도 undefined를 보여 주지 않는다', async () => {
    const t = await setup(() => json(403, { status: 403, error: 'Forbidden', path: '/a' }))
    const error = (await t.client.http('GET', '/a').catch((reason: unknown) => reason)) as ApiError
    expect(error.code).toBe('UNKNOWN')
    expect(error.message).toBe('요청을 처리하지 못했습니다 (403)')
  })

  it('명세의 오류 코드는 그대로 두고, 다시 보낼 오류로 치지 않는다', async () => {
    const t = await setup(() => json(502, { error: { code: 'WEBSHELL_UNAVAILABLE', message: 'x' } }))
    const error = await t.client.http('GET', '/a').catch((reason: unknown) => reason)
    expect(error).toMatchObject({ status: 502, code: 'WEBSHELL_UNAVAILABLE' })
    expect(t.client.isTransientError(error)).toBe(false)
  })

  it.each([200, 201, 202, 204])('%i의 빈 본문은 던지지 않는다', async (status) => {
    const t = await setup(() => new Response(status === 204 ? null : '', { status }))
    await expect(t.client.http('POST', '/a')).resolves.toBeUndefined()
  })

  it('200인데 HTML이면 JSON 해석 오류 대신 읽을 수 있는 오류를 낸다', async () => {
    const t = await setup(() => new Response('<!doctype html>', { status: 200 }))
    await expect(t.client.http('GET', '/a')).rejects.toMatchObject({ code: 'BAD_RESPONSE', message: expect.stringContaining('서버 응답을 읽지 못했습니다') })
  })
})

describe('API 주소', () => {
  it.each([
    ['/api/v1', '/api/v1'],
    ['/api/v1/', '/api/v1'],
    ['/api/v1//', '/api/v1'],
    ['https://example.com/api/v1/', 'https://example.com/api/v1'],
    [' /api/v1 ', '/api/v1'],
  ])('%j는 %j로 쓴다', async (given, expected) => {
    const { normalizeBaseUrl } = await import('./client')
    expect(normalizeBaseUrl(given)).toBe(expected)
  })

  it('끝에 /가 있어도 경로가 겹치지 않고, 값이 있으면 목을 쓰지 않는다', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '/proxy/api/v1/')
    const t = await setup(() => json(200, {}))
    await t.client.http('GET', '/me')
    expect(t.calls[0].url).toBe('/proxy/api/v1/me')
    expect(t.client.USE_MOCK).toBe(false)
  })

  it('값이 없으면 목을 쓴다', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '')
    const t = await setup(() => json(200, {}))
    expect(t.client.USE_MOCK).toBe(true)
    await t.client.http('GET', '/me')
    expect(t.calls[0].url).toBe('/api/v1/me')
  })
})
