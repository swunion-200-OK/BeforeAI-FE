import { ApiError } from './errors'
import type { Network, TokenResponse } from './types'

/** 이 값만 바꾸면 실제 백엔드로 전환된다. 비어 있으면 목 API를 쓴다. */
const CONFIGURED_BASE_URL: string | undefined = import.meta.env.VITE_API_BASE_URL

/** 경로를 그대로 이어 붙이므로 끝의 /는 뗀다. 상대 경로(/api/v1)와 전체 주소를 모두 받는다. */
export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

export const USE_MOCK = !CONFIGURED_BASE_URL
export const API_BASE_URL = normalizeBaseUrl(CONFIGURED_BASE_URL || '/api/v1')

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
  headers?: Record<string, string>
}

const NETWORK_ERROR_MESSAGE = '서버에 연결하지 못했습니다. 네트워크 상태를 확인하고 다시 시도해 주세요'
const BAD_RESPONSE_MESSAGE = '서버 응답을 읽지 못했습니다. 잠시 후 다시 시도해 주세요'
const GATEWAY_STATUSES = [502, 503, 504]
const REFRESH_TIMEOUT_MS = 10_000

/** fetch는 연결 실패를 TypeError로 던진다. 화면에 "Failed to fetch"가 나가지 않게 바꾸고, 중단(AbortError)은 그대로 둔다. */
export function toNetworkError(reason: unknown): unknown {
  return reason instanceof TypeError ? new ApiError(0, 'NETWORK_ERROR', NETWORK_ERROR_MESSAGE) : reason
}

/** 다시 보내면 나을 수 있는 실패: 연결 실패, 프록시가 대신 답한 502·503·504. 서버가 코드로 답한 오류는 다시 보내도 같다. */
export function isTransientError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false
  return error.status === 0 || (error.code === 'UNKNOWN' && GATEWAY_STATUSES.includes(error.status))
}

function readNetwork(response: Response) {
  const network = response.headers.get('X-Network')
  if (network === 'INTERNAL' || network === 'EXTERNAL') networkStore.set(network)
}

function expireSession() {
  // 동시에 실패한 요청이 여럿이어도 만료 처리는 한 번만 한다.
  if (accessToken === null) return
  setAccessToken(null)
  onSessionExpired()
}

/** 헤더·토큰을 붙여 보내고, 401이면 한 번 재발급한 뒤 다시 보낸다. 오류 변환은 호출한 쪽에서 한다. */
export async function rawFetch(method: string, path: string, options: RequestOptions = {}): Promise<Response> {
  let sentToken: string | null = null
  const send = async () => {
    const headers: Record<string, string> = { ...options.headers }
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'
    sentToken = accessToken
    if (sentToken) headers.Authorization = `Bearer ${sentToken}`
    try {
      const response = await transport(`${API_BASE_URL}${path}${buildQuery(options.query)}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal,
      })
      readNetwork(response)
      return response
    } catch (reason) {
      throw toNetworkError(reason)
    }
  }

  // 재발급 중이면(새로고침 직후 포함) 끝나길 기다렸다가 새 토큰으로 보낸다.
  if (refreshing && !options.skipRefresh) await refreshing

  let response = await send()
  // 토큰 없이 보낸 요청이나 그사이 로그아웃한 경우에는 재발급할 세션이 없다.
  if (response.status === 401 && !options.skipRefresh && sentToken && accessToken) {
    // 보낸 뒤에 다른 요청이 이미 재발급했으면 또 재발급하지 않고 그 토큰으로 다시 보낸다.
    if (accessToken !== sentToken || (await tryRefresh())) {
      response = await send()
      // 막 받은 토큰도 거부되면 이 세션은 쓸 수 없다. 요청마다 재발급을 되풀이하지 않고 끝낸다.
      if (response.status === 401) expireSession()
    } else if (!refreshUnreachable) {
      expireSession()
    }
    // 서버에 닿지 못했으면 세션이 끊겼다고 단정하지 않는다. 이 요청만 실패로 두고 다음 요청에서 다시 재발급한다.
  }
  return response
}

let refreshing: Promise<boolean> | null = null
/** 마지막 재발급이 서버의 거부가 아니라 연결 실패나 서버 오류로 끝났다 */
let refreshUnreachable = false

/** 다른 탭과도 순서를 맞춘다. 잠금은 HTTPS나 localhost에서만 있고, 없으면 이 탭 안에서만 한 번으로 묶는다. */
function withRefreshLock(task: () => Promise<boolean>): Promise<boolean> {
  const locks = globalThis.navigator?.locks
  return locks ? locks.request('auth-refresh', task).catch(() => false) : task()
}

/** 동시에 401이 나도 재발급은 한 번만 한다. 리프레시 토큰을 교체하는 서버에서 세션이 끊기지 않게 한다. */
function tryRefresh(): Promise<boolean> {
  const tokenBefore = accessToken
  refreshing ??= withRefreshLock(async () => {
    refreshUnreachable = false
    try {
      const res = await transport(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        // 응답이 오지 않아도 부팅 화면에 갇히지 않게 한다.
        signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
      })
      readNetwork(res)
      if (!res.ok) {
        refreshUnreachable = res.status >= 500
        return false
      }
      const data = (await res.json()) as Partial<TokenResponse>
      if (!data.accessToken) return false
      // 기다리는 사이 로그아웃했거나 다른 사용자로 로그인했으면 이 결과로 세션을 되살리지 않는다.
      if (accessToken !== tokenBefore) return accessToken !== null
      setAccessToken(data.accessToken)
      return true
    } catch {
      // 연결 실패, 시간 초과, 프록시가 준 HTML은 쿠키가 죽었다는 뜻이 아니다.
      refreshUnreachable = true
      return false
    }
  }).finally(() => {
    refreshing = null
  })
  return refreshing
}

/**
 * 서버 쪽 값이 바뀌어 지금 토큰이 낡았을 때 새 토큰을 받는다. 비밀번호 변경 필요 표시가 토큰 안에 있어,
 * 바꾼 뒤에도 옛 토큰으로는 다른 API가 모두 409다. 받으면 true.
 */
export function renewAccessToken(): Promise<boolean> {
  return tryRefresh()
}

let restoring: Promise<boolean> | null = null

/**
 * 새로고침하면 메모리의 액세스 토큰이 사라지므로 리프레시 쿠키로 다시 받는다.
 * 페이지당 한 번만 보낸다. StrictMode가 effect를 두 번 돌려도 두 번 보내면, 교체된 쿠키로 나간 두 번째 요청 때문에 세션이 끊긴다.
 */
export async function restoreSession(): Promise<boolean> {
  restoring ??= tryRefresh()
  await restoring
  return accessToken !== null
}

/** 복원 실패의 원인이 서버에 닿지 못한 것인지 알려 준다. 이때는 로그인 화면으로 보내지 않고 다시 시도하게 한다. */
export function isSessionUnreachable(): boolean {
  return accessToken === null && refreshUnreachable
}

/** 서버에 닿지 못해 끝난 복원을 다시 시도한다. 앞선 요청이 끝난 뒤에만 부르므로 재발급이 겹치지 않는다. */
export function retryRestoreSession(): Promise<boolean> {
  restoring = null
  return restoreSession()
}

export const SESSION_UNREACHABLE_MESSAGE = '서버에 연결하지 못해 로그인 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요'

/** 쿠키는 서버만 지울 수 있다. 토큰이 이미 만료됐어도 재발급해서 끝까지 로그아웃한다. 재발급도 안 되면 쿠키가 이미 죽은 것이다. */
export async function logout(): Promise<void> {
  if (refreshing) await refreshing
  const send = () => rawFetch('POST', '/auth/logout', { skipRefresh: true })
  const response = await send()
  if (response.status === 401 && (await tryRefresh())) await send()
}

/** 프록시의 HTML, 빈 502, Spring 기본 오류처럼 명세의 오류 모양이 아닌 답도 읽을 수 있는 문장으로 바꾼다. */
export async function toApiError(response: Response): Promise<ApiError> {
  const fallback = GATEWAY_STATUSES.includes(response.status)
    ? `서버에 일시적인 문제가 있습니다. 잠시 후 다시 시도해 주세요 (${response.status})`
    : `요청을 처리하지 못했습니다 (${response.status})`
  try {
    const { error } = (await response.json()) as {
      error?: { code?: string; message?: string; details?: Record<string, unknown> }
    }
    if (typeof error?.code === 'string') {
      return new ApiError(response.status, error.code, error.message ?? fallback, error.details)
    }
  } catch {
    // 아래의 공통 문장으로 답한다.
  }
  return new ApiError(response.status, 'UNKNOWN', fallback)
}

export async function http<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const response = await rawFetch(method, path, options)
  if (!response.ok) throw await toApiError(response)
  let text: string
  try {
    text = await response.text()
  } catch (reason) {
    throw toNetworkError(reason)
  }
  // 201·202도 본문이 비어 있을 수 있다.
  if (text.trim() === '') return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ApiError(response.status, 'BAD_RESPONSE', BAD_RESPONSE_MESSAGE)
  }
}

async function fetchBlob(path: string, signal?: AbortSignal): Promise<Blob> {
  const response = await rawFetch('GET', path, { signal })
  if (!response.ok) throw await toApiError(response)
  return response.blob().catch((reason: unknown) => {
    throw toNetworkError(reason)
  })
}

const PDF_HEADER = '%PDF-'

/**
 * PDF를 받는다. 프록시가 200으로 준 HTML을 .pdf로 저장하지 않게 머리를 확인하고,
 * 그런 내용이 이 앱의 출처에서 실행되지 않게 형식을 PDF로 고정한다.
 */
export async function fetchPdf(path: string, signal?: AbortSignal): Promise<Blob> {
  const blob = await fetchBlob(path, signal)
  if ((await blob.slice(0, PDF_HEADER.length).text()) !== PDF_HEADER) {
    throw new ApiError(200, 'BAD_RESPONSE', BAD_RESPONSE_MESSAGE)
  }
  return blob.slice(0, blob.size, 'application/pdf')
}

/** 링크로 받으면 인증 토큰을 실을 수 없어, 토큰을 붙여 받은 내용을 브라우저 다운로드로 넘긴다. */
export async function downloadFile(path: string, fileName: string): Promise<void> {
  saveBlob(await fetchBlob(path), fileName)
}

export async function downloadPdf(path: string, fileName: string): Promise<void> {
  saveBlob(await fetchPdf(path), fileName)
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
