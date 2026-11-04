import { accountRoutes, issueToken, userFromToken } from './routes/account'
import { projectRoutes } from './routes/projects'
import { requestRoutes } from './routes/requests'
import { resumeTimers } from './engine'
import { matchRoute, type Route } from './router'
import { buildSeed } from './seed'
import { deviceStore } from '../../crypto/deviceStore'
import {
  HttpError,
  db,
  loadPersisted,
  mockConfig,
  onDbChange,
  persist,
  setDb,
  type MockDb,
  type SlackMessage,
} from './store'
import type { Network, Role } from '../types'

const routes: Route[] = [...accountRoutes, ...projectRoutes, ...requestRoutes]
const API_PREFIX = '/api/v1'
const EXTERNAL_IDLE_LIMIT_MS = 30 * 60 * 1000

let ready = false

export function initMock() {
  if (ready) return
  const persisted: MockDb | null = loadPersisted()
  if (persisted) {
    setDb(persisted)
    resumeTimers()
  } else {
    buildSeed()
    resumeTimers()
    persist()
  }
  ready = true
}

function json(status: number, body: unknown, network: Network): Response {
  const headers = { 'Content-Type': 'application/json', 'X-Network': network }
  if (body === undefined) return new Response(null, { status: 204, headers: { 'X-Network': network } })
  return new Response(JSON.stringify(body), { status, headers })
}

function errorResponse(error: HttpError, network: Network) {
  return json(error.status, { error: { code: error.code, message: error.message, details: error.details } }, network)
}

export async function mockFetch(input: string, init: RequestInit = {}): Promise<Response> {
  initMock()
  const url = new URL(input, 'http://mock.local')
  const path = url.pathname.startsWith(API_PREFIX) ? url.pathname.slice(API_PREFIX.length) : url.pathname
  const method = (init.method ?? 'GET').toUpperCase()
  if (mockConfig.latencyMs) await new Promise((resolve) => setTimeout(resolve, mockConfig.latencyMs))

  const database = db()
  const network = database.network
  try {
    const matched = matchRoute(routes, method, path)
    if (!matched) throw new HttpError(404, 'NOT_FOUND', `없는 API입니다: ${method} ${path}`)
    const { route, params } = matched

    const headers = new Headers(init.headers)
    const me = userFromToken(headers.get('Authorization'))
    if (!route.anonymous) {
      if (!me) throw new HttpError(401, 'UNAUTHENTICATED', '로그인이 필요합니다')
      const session = database.session
      if (network === 'EXTERNAL' && session && Date.now() - session.lastActiveAt > EXTERNAL_IDLE_LIMIT_MS) {
        database.session = null
        throw new HttpError(401, 'UNAUTHENTICATED', '외부망 세션이 만료되었습니다')
      }
      if (session) session.lastActiveAt = Date.now()
      if (route.internal && network !== 'INTERNAL') {
        throw new HttpError(403, 'INTERNAL_NETWORK_ONLY', '내부망에서만 가능한 기능입니다')
      }
      if (route.roles && !route.roles.includes(me.role)) {
        throw new HttpError(403, 'FORBIDDEN_ROLE', '권한이 없습니다')
      }
    }

    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    const result = route.handler({
      params,
      query: url.searchParams,
      body,
      me: me as NonNullable<typeof me>,
      network,
      signal: init.signal ?? undefined,
    })
    if (method !== 'GET') persist()
    if (result instanceof Response) {
      result.headers.set('X-Network', network)
      return result
    }
    return json(route.status ?? 200, result, network)
  } catch (error) {
    if (error instanceof HttpError) {
      if (method !== 'GET') persist()
      return errorResponse(error, network)
    }
    console.error('[mock]', error)
    return json(500, { error: { code: 'INTERNAL', message: '목 서버 오류입니다', details: {} } }, network)
  }
}

/** 개발용 전환 툴바가 쓰는 제어 함수. 실제 API에는 없는 기능이다. */
export const devControls = {
  state() {
    initMock()
    const database = db()
    return {
      network: database.network,
      currentUserId: database.session?.userId ?? null,
      users: database.users
        .filter((u) => u.active)
        .map((u) => ({ id: u.id, name: u.name, role: u.role as Role, departmentId: u.departmentId })),
      slackOutbox: database.slackOutbox as SlackMessage[],
    }
  },
  setNetwork(network: Network) {
    db().network = network
    persist()
  },
  /** 고른 사용자로 바로 세션을 만들고 액세스 토큰을 돌려준다. */
  switchUser(userId: string): string {
    db().session = { userId, lastActiveAt: Date.now() }
    persist()
    return issueToken(userId)
  },
  /** 시드로 되돌린다. 지금 사용자와 망은 그대로 둔다. */
  reset() {
    const before = db()
    const { network, session } = before
    deviceStore.clear()
    buildSeed()
    const database = db()
    database.network = network
    database.session = session
    resumeTimers()
    persist()
  },
  /** 시연 가이드용: 이 프롬프트로 만든 가장 최근 요청. 없으면 같은 내용의 시드 요청을 쓴다. */
  latestRequestId(prompt: string): string {
    const match = db().requests
      .filter((request) => request.prompt === prompt && request.id !== 'r-main')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    return match?.id ?? 'r-main'
  },
  subscribe: onDbChange,
}
