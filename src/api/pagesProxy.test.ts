import { describe, expect, it, vi } from 'vitest'
import { proxyToApi } from './pagesProxy'

const TARGET = 'https://api.example.test'

function capture(response = new Response('ok')) {
  return vi.fn<typeof fetch>(async () => response)
}

describe('Pages /api 프록시', () => {
  it('경로와 쿼리를 대상 서버로 그대로 넘긴다', async () => {
    const fetcher = capture()
    await proxyToApi(new Request('https://site.test/api/v1/requests?limit=3'), TARGET, fetcher)
    expect(String(fetcher.mock.calls[0][0])).toBe('https://api.example.test/api/v1/requests?limit=3')
  })

  it('망 판정에 쓰이는 헤더는 넘기지 않고, 인증과 쿠키는 넘긴다', async () => {
    const fetcher = capture()
    const request = new Request('https://site.test/api/v1/me', {
      headers: { 'X-Access-Network': 'internal', 'X-Forwarded-For': '100.85.55.35', 'X-Real-IP': '100.85.55.35', Authorization: 'Bearer t', Cookie: 'refreshToken=r' },
    })
    await proxyToApi(request, TARGET, fetcher)
    const headers = fetcher.mock.calls[0][1]?.headers as Headers
    expect(headers.get('x-access-network')).toBeNull()
    expect(headers.get('x-forwarded-for')).toBeNull()
    expect(headers.get('x-real-ip')).toBeNull()
    expect(headers.get('authorization')).toBe('Bearer t')
    expect(headers.get('cookie')).toBe('refreshToken=r')
  })

  it('POST 본문을 넘기고 리다이렉트를 따라가지 않는다', async () => {
    const fetcher = capture()
    await proxyToApi(new Request('https://site.test/api/v1/auth/login', { method: 'POST', body: '{"a":1}' }), TARGET, fetcher)
    const init = fetcher.mock.calls[0][1]
    expect(init?.method).toBe('POST')
    expect(init?.redirect).toBe('manual')
    expect(init?.body).toBeTruthy()
  })

  it('응답의 Set-Cookie와 스트림 본문을 그대로 돌려준다', async () => {
    const upstream = new Response('data: 1\n\n', { headers: { 'Set-Cookie': 'refreshToken=r; HttpOnly; Secure; SameSite=Strict', 'Content-Type': 'text/event-stream' } })
    const result = await proxyToApi(new Request('https://site.test/api/v1/x'), TARGET, capture(upstream))
    expect(result.headers.get('set-cookie')).toContain('SameSite=Strict')
    expect(result.headers.get('content-type')).toBe('text/event-stream')
    expect(await result.text()).toBe('data: 1\n\n')
  })

  it('대상 주소가 없으면 503, /api 밖 경로는 넘기지 않는다', async () => {
    expect((await proxyToApi(new Request('https://site.test/api/v1/me'), undefined)).status).toBe(503)
    const fetcher = capture()
    expect((await proxyToApi(new Request('https://site.test/login'), TARGET, fetcher)).status).toBe(404)
    expect(fetcher).not.toHaveBeenCalled()
  })
})
