import { rawFetch, toApiError } from './client'

/**
 * Server-Sent Events를 fetch로 읽는다.
 * EventSource는 Authorization 헤더를 못 보내서 Bearer 토큰 인증과 맞지 않는다.
 */
export async function streamEvents<T>(
  path: string,
  onEvent: (event: T) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await rawFetch('GET', path, { signal })
  if (!response.ok) throw await toApiError(response)
  if (!response.body) return

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return
      buffer += value
      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const chunk = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const data = chunk
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n')
        if (data) onEvent(JSON.parse(data) as T)
        boundary = buffer.indexOf('\n\n')
      }
    }
  } finally {
    reader.cancel().catch(() => {})
  }
}
