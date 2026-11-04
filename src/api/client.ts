import { ApiError } from './errors'
import type { Network, TokenResponse } from './types'

/** 이 값만 바꾸면 실제 백엔드로 전환된다. 비어 있으면 목 API를 쓴다. */
const CONFIGURED_BASE_URL: string | undefined = import.meta.env?.VITE_API_BASE_URL

export const USE_MOCK = !CONFIGURED_BASE_URL
export const API_BASE_URL = CONFIGURED_BASE_URL ?? '/api/v1'

type Transport = (input: string, init: RequestInit) => Promise<Response>

let transport: Transport = (input, init) => fetch(input, { credentials: 'include', ...init })
let accessToken: string | null = null
let onSessionExpired: () => void = () => {}

export function setTransport(next: Transport) {
  transport = next
}

export function setAccessToken(token: string | null) {
  accessToken = token
}

export function getAccessToken() {
  return accessToken
}

export function setSessionExpiredHandler(handler: () => void) {
  onSessionExpired = handler
}

// ── 응답 헤더 X-Network로 받은 현재 접속 환경 ──────────────
let currentNetwork: Network | null = null
const networkListeners = new Set<() => void>()

export const networkStore = {
  get: () => currentNetwork,
  subscribe(listener: () => void) {
    networkListeners.add(listener)
    return () => {
      networkListeners.delete(listener)
    }
  },
  set(value: Network | null) {
    if (value === currentNetwork) return
    currentNetwork = value
    networkListeners.forEach((listener) => listener())
  },
}

function buildQuery(query?: Record<string, unknown>): string {
  if (!query) return ''
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  }
  const text = params.toString()
  return text ? `?${text}` : ''
}

interface RequestOptions {
  query?: Record<string, unknown>
  body?: unknown
  /** 인증 라우트에서는 401이 나도 토큰 재발급을 시도하지 않는다. */
  skipRefresh?: boolean
  signal?: AbortSignal
}

/** 헤더·토큰을 붙여 보내고, 401이면 한 번 재발급한 뒤 다시 보낸다. 오류 변환은 호출한 쪽에서 한다. */
export async function rawFetch(method: string, path: string, options: RequestOptions = {}): Promise<Response> {
  const send = () => {
    const headers: Record<string, string> = {}
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`
    return transport(`${API_BASE_URL}${path}${buildQuery(options.query)}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    })
  }

  let response = await send()
  const network = response.headers.get('X-Network')
  if (network === 'INTERNAL' || network === 'EXTERNAL') networkStore.set(network)

  if (response.status === 401 && !options.skipRefresh && accessToken) {
    if (await tryRefresh()) {
      response = await send()
    } else {
      setAccessToken(null)
      onSessionExpired()
    }
  }
  return response
}

async function tryRefresh(): Promise<boolean> {
  try {
    const res = await transport(`${API_BASE_URL}/auth/refresh`, { method: 'POST' })
    if (!res.ok) return false
    const data = (await res.json()) as TokenResponse
    setAccessToken(data.accessToken)
    return true
  } catch {
    return false
  }
}

export async function toApiError(response: Response): Promise<ApiError> {
  try {
    const { error } = (await response.json()) as {
      error: { code: string; message: string; details?: Record<string, unknown> }
    }
    return new ApiError(response.status, error.code, error.message, error.details)
  } catch {
    return new ApiError(response.status, 'UNKNOWN', `요청을 처리하지 못했습니다 (${response.status})`)
  }
}

export async function http<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const response = await rawFetch(method, path, options)
  if (!response.ok) throw await toApiError(response)
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}
