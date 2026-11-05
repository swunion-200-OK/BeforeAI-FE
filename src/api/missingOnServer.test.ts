import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ACCESS_TOKEN = 'token-1'

/** 실제 서버 모드(VITE_API_BASE_URL 있음)로 모듈을 새로 읽는다. 전송은 가로채므로 네트워크로 나가지 않는다. */
async function realMode(reply: (url: string) => Response) {
  vi.resetModules()
  vi.stubEnv('VITE_API_BASE_URL', '/api/v1')
  const client = await import('./client')
  const endpoints = await import('./endpoints')
  const missing = await import('./missingOnServer')
  const errors = await import('./errors')
  const sent: string[] = []
  client.setTransport(async (input) => {
    sent.push(input)
    return reply(input)
  })
  client.setAccessToken(ACCESS_TOKEN)
  const expired = vi.fn()
  client.setSessionExpiredHandler(expired)
  return { client, endpoints, missing, errors, sent, expired }
}

/** 없는 경로에 대한 서버 답 (GlobalExceptionHandler) */
const routeNotFound = () =>
  new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: '대상을 찾을 수 없습니다', details: {} } }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  })

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => ({ click: () => {} }) })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('서버에 없는 API (실제 서버 모드)', () => {
  it('목 모드가 아니다', async () => {
    const { client } = await realMode(routeNotFound)
    expect(client.USE_MOCK).toBe(false)
  })

  it('승인 기록 문서의 404는 "없는 기능"으로 바꾸지 않는다. 문서가 아직 없다는 답과 구분되지 않는다', async () => {
    const { endpoints, missing, expired } = await realMode(routeNotFound)
    const { approvalDocumentApi } = endpoints
    for (const call of [
      () => approvalDocumentApi.latest('r'),
      () => approvalDocumentApi.versions('r'),
      () => approvalDocumentApi.version('r', 1),
      () => approvalDocumentApi.download('r'),
    ]) {
      const error = await call().catch((reason: unknown) => reason)
      expect(error).toMatchObject({ status: 404, code: 'NOT_FOUND' })
      expect(missing.isMissingOnServer(error)).toBe(false)
    }
    expect(expired).not.toHaveBeenCalled()
  })

  it('목록의 4건은 404면 모두 "아직 없는 기능" 오류가 된다', async () => {
    const { endpoints, missing } = await realMode(routeNotFound)
    const { adminApi, meApi, projectsApi } = endpoints
    const calls = [
      () => meApi.notificationSettings(),
      () => meApi.updateNotificationSettings({ slackUserId: null, approvalRequests: true, requestResults: true }),
      () => adminApi.updateSlack({ workspace: 'w', defaultChannel: '#c' }),
      () => projectsApi.updateOwners('p', ['a', 'b']),
    ]
    expect(calls).toHaveLength(missing.MISSING_ON_SERVER.length)
    for (const call of calls) {
      const error = await call().catch((reason: unknown) => reason)
      expect(missing.isMissingOnServer(error)).toBe(true)
      expect((error as Error).message).toBe(missing.MISSING_ON_SERVER_MESSAGE)
    }
  })

  it('404는 토큰 재발급도 로그아웃도 부르지 않고 한 번만 보낸다', async () => {
    const { endpoints, sent, expired, client } = await realMode(routeNotFound)
    await endpoints.meApi.notificationSettings().catch(() => {})
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('/me/notification-settings')
    expect(sent.some((url) => url.includes('/auth/refresh'))).toBe(false)
    expect(expired).not.toHaveBeenCalled()
    // 세션은 그대로라 다음 요청에도 같은 토큰을 쓴다.
    expect(client.isSessionUnreachable()).toBe(false)
  })

  it('목록에 없는 API의 404는 그대로 진짜 오류다', async () => {
    const { endpoints, missing, errors } = await realMode(routeNotFound)
    const error = await endpoints.requestsApi.get('r').catch((reason: unknown) => reason)
    expect(missing.isMissingOnServer(error)).toBe(false)
    expect(error).toBeInstanceOf(errors.ApiError)
    expect((error as { code: string }).code).toBe('NOT_FOUND')
  })

  it('서버에 생긴 API의 404는 "없는 기능"이 아니라 그런 대상이 없다는 답이다', async () => {
    const { endpoints, missing } = await realMode(routeNotFound)
    const { auditApi, auditExportApi, dashboardApi, documentsApi, requestsApi } = endpoints
    const calls = [
      () => requestsApi.taskDocument('r', 't'),
      () => requestsApi.rollback('r', { taskIds: ['t'], targetVersion: 1 }),
      () => documentsApi.list('p'),
      () => documentsApi.versions('d'),
      () => documentsApi.version('d', 1),
      () => dashboardApi.get('ME'),
      () => auditApi.list({}),
      () => auditApi.get('l'),
      () => auditExportApi.create({ format: 'CSV', filters: {} }),
      () => auditExportApi.list(),
      () => auditExportApi.get('e'),
      () => auditExportApi.download('e', 'a.csv'),
    ]
    for (const call of calls) {
      const error = await call().catch((reason: unknown) => reason)
      expect(missing.isMissingOnServer(error)).toBe(false)
    }
  })

  it('없는 API라도 500과 403은 있는 그대로 알린다', async () => {
    let status = 500
    const { endpoints, missing } = await realMode(
      () => new Response(JSON.stringify({ error: { code: status === 403 ? 'FORBIDDEN_ROLE' : 'INTERNAL_ERROR', message: 'x', details: {} } }), { status }),
    )
    expect(missing.isMissingOnServer(await endpoints.meApi.notificationSettings().catch((reason: unknown) => reason))).toBe(false)
    status = 403
    expect(missing.isMissingOnServer(await endpoints.projectsApi.updateOwners('p', ['a', 'b']).catch((reason: unknown) => reason))).toBe(false)
  })
})

describe('목 모드', () => {
  it('목의 404는 "그런 대상이 없다"는 진짜 답이라 바꾸지 않는다', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_API_BASE_URL', '')
    const { setTransport } = await import('./client')
    const { meApi } = await import('./endpoints')
    const { isMissingOnServer } = await import('./missingOnServer')
    setTransport(async () => routeNotFound())
    const error = await meApi.notificationSettings().catch((reason: unknown) => reason)
    expect(isMissingOnServer(error)).toBe(false)
  })
})
