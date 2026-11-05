import { rawFetch, toApiError, toNetworkError } from './client'
import { ApiError } from './errors'

export const RECONNECT_BASE_MS = 1500
export const RECONNECT_MAX_MS = 30_000
/** 스트림을 못 쓰는 환경으로 보고 조회 API로도 받기 시작하는 연속 실패 횟수 */
export const POLL_AFTER_FAILURES = 3
/** 하트비트가 30초마다 온다(명세 4.9). 두 번 넘게 소식이 없으면 끊긴 줄도 모른 채 멈춘 연결로 본다 (Wi-Fi 전환 등). */
export const STREAM_STALL_MS = 75_000

export function reconnectDelay(failures: number): number {
  return Math.min(RECONNECT_BASE_MS * 2 ** failures, RECONNECT_MAX_MS)
}

/** 권한이 없다는 답이면 다시 연결해도 소용없다. 이 API들은 볼 수 없는 요청에 404를 준다. */
export function isStreamDenied(reason: unknown): boolean {
  return reason instanceof ApiError && [401, 403, 404].includes(reason.status)
}

export interface SseMessage {
  id: string | null
  event: string
  data: string
}

/**
 * SSE 형식을 읽는다 (WHATWG). 줄 끝은 LF, CRLF, CR 모두 받고, 조각 사이에서 줄이나 CRLF가 갈려도 된다.
 * 빈 줄에서 메시지 하나가 끝난다. 끝나지 않은 마지막 메시지는 버린다.
 */
export function createSseParser(onMessage: (message: SseMessage) => void) {
  let buffer = ''
  let started = false
  let skipLf = false
  let id: string | null = null
  let event = ''
  let data: string[] = []

  const line = (text: string) => {
    if (text === '') {
      if (data.length > 0) onMessage({ id, event: event || 'message', data: data.join('\n') })
      id = null
      event = ''
      data = []
      return
    }
    if (text.startsWith(':')) return
    const colon = text.indexOf(':')
    const field = colon === -1 ? text : text.slice(0, colon)
    const value = colon === -1 ? '' : text.slice(colon + 1).replace(/^ /, '')
    if (field === 'data') data.push(value)
    else if (field === 'event') event = value
    else if (field === 'id' && !value.includes('\0')) id = value
  }

  return (chunk: string) => {
    // 앞 조각이 CR로 끝났으면 이 조각 맨 앞의 LF는 같은 줄 끝이다.
    const text = skipLf && chunk.startsWith('\n') ? chunk.slice(1) : chunk
    if (chunk.length > 0) skipLf = chunk.endsWith('\r')
    buffer += text
    if (!started && buffer.length > 0) {
      started = true
      buffer = buffer.replace(/^\uFEFF/, '')
    }
    const parts = buffer.split(/\r\n|\n|\r/)
    buffer = parts.pop() ?? ''
    parts.forEach(line)
  }
}

/**
 * Server-Sent Events를 fetch로 읽는다.
 * EventSource는 Authorization 헤더를 못 보내서 Bearer 토큰 인증과 맞지 않는다.
 * 토큰이 만료된 뒤 다시 연결하면 rawFetch가 재발급을 거쳐 연다. 서버가 닫거나 연결이 멈추면 정상 종료하고, 다시 연결은 호출한 쪽이 정한다.
 */
export async function streamMessages(
  path: string,
  onMessage: (message: SseMessage) => void,
  signal: AbortSignal,
  lastEventId?: string,
  onOpen?: () => void,
): Promise<void> {
  const headers: Record<string, string> = { Accept: 'text/event-stream' }
  if (lastEventId !== undefined) headers['Last-Event-ID'] = lastEventId
  const response = await rawFetch('GET', path, { signal, headers })
  if (!response.ok) throw await toApiError(response)
  const contentType = response.headers.get('Content-Type')
  if (contentType && !contentType.includes('text/event-stream')) {
    // 프록시나 정적 호스팅이 HTML을 200으로 돌려준 경우다. 읽으면 조용히 아무것도 안 온다.
    void response.body?.cancel().catch(() => {})
    throw new ApiError(response.status, 'BAD_RESPONSE', '실시간 연결을 열지 못했습니다')
  }
  if (!response.body) return
  onOpen?.()

  const parse = createSseParser((message) => {
    if (signal.aborted) return
    // 메시지 하나가 깨졌다고 연결을 버리지 않는다. 다시 연결해도 같은 메시지에서 또 끊긴다.
    try {
      onMessage(message)
    } catch (reason) {
      console.warn('SSE 메시지를 처리하지 못했습니다', reason)
    }
  })
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let stall: ReturnType<typeof setTimeout> | undefined
  const watchStall = () => {
    clearTimeout(stall)
    stall = setTimeout(() => void reader.cancel().catch(() => {}), STREAM_STALL_MS)
  }
  try {
    watchStall()
    while (true) {
      const { done, value } = await reader.read()
      if (done) return
      watchStall()
      parse(value)
    }
  } catch (reason) {
    throw toNetworkError(reason)
  } finally {
    clearTimeout(stall)
    reader.cancel().catch(() => {})
  }
}

export function streamEvents<T>(path: string, onEvent: (event: T) => void, signal: AbortSignal): Promise<void> {
  return streamMessages(
    path,
    ({ event, data }) => {
      if (event !== 'heartbeat') onEvent(JSON.parse(data) as T)
    },
    signal,
  )
}
