import type { Network, Role } from '../types'
import type { StoredUser } from './store'

export interface Ctx {
  params: Record<string, string>
  query: URLSearchParams
  // 목 라우트는 요청 본문을 그때그때 필요한 모양으로 읽는다.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any
  me: StoredUser
  network: Network
  signal?: AbortSignal
}

export interface Route {
  method: string
  path: string
  /** 내부망 전용이면 true (외부망에서 403 INTERNAL_NETWORK_ONLY) */
  internal?: boolean
  roles?: Role[]
  /** 로그인 전에도 호출할 수 있는 라우트 */
  anonymous?: boolean
  status?: number
  handler: (ctx: Ctx) => unknown
}

export function route(
  method: string,
  path: string,
  handler: Route['handler'],
  options: Omit<Route, 'method' | 'path' | 'handler'> = {},
): Route {
  return { method, path, handler, ...options }
}

export function matchRoute(
  routes: Route[],
  method: string,
  path: string,
): { route: Route; params: Record<string, string> } | null {
  const segments = path.split('/').filter(Boolean)
  for (const candidate of routes) {
    if (candidate.method !== method) continue
    const pattern = candidate.path.split('/').filter(Boolean)
    if (pattern.length !== segments.length) continue
    const params: Record<string, string> = {}
    const matched = pattern.every((part, index) => {
      if (part.startsWith(':')) {
        params[part.slice(1)] = decodeURIComponent(segments[index])
        return true
      }
      return part === segments[index]
    })
    if (matched) return { route: candidate, params }
  }
  return null
}

/** 커서는 목록 안의 위치다. */
export function paginate<T>(items: T[], query: URLSearchParams) {
  const limit = Math.min(Number(query.get('limit')) || 20, 100)
  const offset = Number(query.get('cursor')) || 0
  const next = offset + limit
  return {
    items: items.slice(offset, next),
    nextCursor: next < items.length ? String(next) : null,
  }
}
