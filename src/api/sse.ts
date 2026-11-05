import { rawFetch, toApiError } from './client'

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
 */
export async function streamMessages(
  path: string,
  onMessage: (message: SseMessage) => void,
  signal: AbortSignal,
  lastEventId?: string,
): Promise<void> {
  const headers: Record<string, string> = { Accept: 'text/event-stream' }
  if (lastEventId !== undefined) headers['Last-Event-ID'] = lastEventId
  const response = await rawFetch('GET', path, { signal, headers })
  if (!response.ok) throw await toApiError(response)
  if (!response.body) return

  const parse = createSseParser((message) => {
    if (!signal.aborted) onMessage(message)
  })
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return
      parse(value)
    }
  } finally {
    reader.cancel().catch(() => {})
  }
}

export function streamEvents<T>(path: string, onEvent: (event: T) => void, signal: AbortSignal): Promise<void> {
  return streamMessages(path, ({ data }) => onEvent(JSON.parse(data) as T), signal)
}
