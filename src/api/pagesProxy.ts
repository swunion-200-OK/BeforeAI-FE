/** 서버가 망 판정에 쓰는 값은 클라이언트가 보내도 넘기지 않는다. */
const DROPPED_HEADERS = ['x-access-network', 'x-network', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'forwarded']

/**
 * 배포 사이트의 /api/* 요청을 백엔드로 넘긴다. 같은 출처가 되어야 SameSite=Strict 쿠키가 실린다.
 * 응답 본문은 그대로 흘려보내 SSE가 끊기지 않고, Set-Cookie도 그대로 전달한다.
 */
export function proxyToApi(request: Request, target: string | undefined, fetcher: typeof fetch = fetch): Promise<Response> {
  if (!target) return Promise.resolve(Response.json({ error: { code: 'INTERNAL', message: 'API 서버 주소가 설정되지 않았습니다', details: {} } }, { status: 503 }))
  const incoming = new URL(request.url)
  const base = new URL(target)
  const url = new URL(incoming.pathname + incoming.search, base)
  // 대상 서버 밖으로 나가는 경로를 만들지 않는다.
  if (url.origin !== base.origin || !incoming.pathname.startsWith('/api/')) {
    return Promise.resolve(Response.json({ error: { code: 'NOT_FOUND', message: '대상을 찾을 수 없습니다', details: {} } }, { status: 404 }))
  }
  const headers = new Headers(request.headers)
  for (const name of DROPPED_HEADERS) headers.delete(name)
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  return fetcher(url, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    redirect: 'manual',
    ...(hasBody ? { duplex: 'half' } : {}),
  } as RequestInit)
}
