// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAccessToken, setSessionExpiredHandler, setTransport } from './client'
import { ApiError } from './errors'
import { createSseParser, type SseMessage, STREAM_STALL_MS, streamEvents, streamMessages } from './sse'

function parse(...chunks: string[]) {
  const messages: SseMessage[] = []
  const feed = createSseParser((message) => messages.push(message))
  chunks.forEach(feed)
  return messages
}

const one = { id: '43', event: 'node.updated', data: '{"a":1}' }

describe('SSE 읽기 (WHATWG)', () => {
  it.each([
    ['LF', '\n'],
    ['CRLF', '\r\n'],
    ['CR', '\r'],
  ])('줄 끝 %s', (_name, end) => {
    expect(parse(`id: 43${end}event: node.updated${end}data: {"a":1}${end}${end}`)).toEqual([one])
  })

  it('CRLF가 조각 사이에서 갈려도 메시지를 한 번만 만든다', () => {
    expect(parse('id: 43\r', '\nevent: node.updated\r\ndata: {"a":1}\r\n\r', '\n')).toEqual([one])
  })

  it('글자 하나씩 와도 읽는다', () => {
    expect(parse(...'id: 43\r\nevent: node.updated\r\ndata: {"a":1}\r\n\r\n'.split(''))).toEqual([one])
  })

  it('주석과 모르는 필드는 건너뛰고 여러 data 줄은 잇는다', () => {
    expect(parse(': ping\n\nretry: 10\ndata: a\ndata: b\n\n')).toEqual([{ id: null, event: 'message', data: 'a\nb' }])
  })

  it('콜론 뒤 공백은 하나만 뗀다', () => {
    expect(parse('data:x\n\ndata:  y\n\n').map((m) => m.data)).toEqual(['x', ' y'])
  })

  it('맨 앞 BOM을 무시하고, 끝나지 않은 메시지는 버린다', () => {
    expect(parse('﻿data: a\n\ndata: 끝나지 않음\n')).toEqual([{ id: null, event: 'message', data: 'a' }])
  })

  it('id는 그 메시지의 것만 돌려준다', () => {
    const messages = parse('id: 1\ndata: a\n\nevent: heartbeat\ndata: b\n\n')
    expect(messages.map((m) => m.id)).toEqual(['1', null])
  })
})

const encoder = new TextEncoder()
const eventStream = (...frames: string[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        frames.forEach((frame) => controller.enqueue(encoder.encode(frame)))
        controller.close()
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
const signal = () => new AbortController().signal

describe('스트림 연결', () => {
  afterEach(() => {
    setAccessToken(null)
    setSessionExpiredHandler(() => {})
    vi.restoreAllMocks()
  })

  it('Last-Event-ID를 보내고, 서버가 닫으면 정상 종료한다', async () => {
    const transport = vi.fn(async (_url: string, _init: RequestInit) => eventStream('id: 7\ndata: {}\n\n'))
    setTransport(transport)
    const messages: SseMessage[] = []
    await streamMessages('/s', (message) => messages.push(message), signal(), '6')
    expect((transport.mock.calls[0][1].headers as Record<string, string>)['Last-Event-ID']).toBe('6')
    expect(messages.map((m) => m.id)).toEqual(['7'])
  })

  it('처음 연결할 때는 Last-Event-ID를 보내지 않는다', async () => {
    const transport = vi.fn(async (_url: string, _init: RequestInit) => eventStream())
    setTransport(transport)
    await streamMessages('/s', () => {}, signal())
    expect(transport.mock.calls[0][1].headers).not.toHaveProperty('Last-Event-ID')
  })

  it('깨진 JSON 하나가 스트림을 죽이지 않고 다음 메시지를 받는다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    setTransport(async () => eventStream('data: {깨짐\n\n', 'data: {"n":2}\n\n'))
    const received: unknown[] = []
    await streamEvents<unknown>('/s', (event) => received.push(event), signal())
    expect(received).toEqual([{ n: 2 }])
  })

  it('heartbeat는 소비자에게 넘기지 않아 다시 그리지 않는다', async () => {
    setTransport(async () => eventStream('event: heartbeat\ndata: {"at":"x"}\n\n', ': ping\n\n', 'event: heartbeat\ndata:\n\n'))
    const onEvent = vi.fn()
    await streamEvents('/s', onEvent, signal())
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('토큰이 만료된 뒤 다시 연결하면 재발급을 거쳐 연다', async () => {
    const seen: Array<string | undefined> = []
    setTransport(async (url, init) => {
      if (url.endsWith('/auth/refresh')) return new Response(JSON.stringify({ accessToken: 'T2' }), { status: 200 })
      const token = (init.headers as Record<string, string>).Authorization
      seen.push(token)
      return token === 'Bearer T2' ? eventStream('data: {}\n\n') : new Response('', { status: 401 })
    })
    setAccessToken('T1')
    const onMessage = vi.fn()
    await streamMessages('/s', onMessage, signal())
    expect(seen).toEqual(['Bearer T1', 'Bearer T2'])
    expect(onMessage).toHaveBeenCalledTimes(1)
  })

  it('재발급이 안 되면 401을 던지고 세션 만료를 알린다', async () => {
    const expired = vi.fn()
    setSessionExpiredHandler(expired)
    setTransport(async () => new Response('', { status: 401 }))
    setAccessToken('T1')
    await expect(streamMessages('/s', () => {}, signal())).rejects.toMatchObject({ status: 401 })
    expect(expired).toHaveBeenCalledTimes(1)
  })

  it('연결 실패와 읽던 중 끊김은 읽을 수 있는 오류로 던진다', async () => {
    setTransport(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(streamMessages('/s', () => {}, signal())).rejects.toMatchObject({ code: 'NETWORK_ERROR' })

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {}\n\n'))
      },
      pull(controller) {
        controller.error(new TypeError('network error'))
      },
    })
    setTransport(async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }))
    await expect(streamMessages('/s', () => {}, signal())).rejects.toBeInstanceOf(ApiError)
  })

  it('프록시가 HTML을 200으로 주면 끊긴 것으로 보고 던진다', async () => {
    setTransport(async () => new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } }))
    await expect(streamMessages('/s', () => {}, signal())).rejects.toMatchObject({ code: 'BAD_RESPONSE' })
  })

  it('중단하면 메시지를 더 넘기지 않는다', async () => {
    const controller = new AbortController()
    setTransport(async () => eventStream('data: 1\n\n', 'data: 2\n\n'))
    const received: string[] = []
    await streamMessages(
      '/s',
      ({ data }) => {
        received.push(data)
        controller.abort()
      },
      controller.signal,
    )
    expect(received).toEqual(['1'])
  })

  describe('멈춘 연결', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('아무것도 오지 않으면 정상 종료해 다시 연결하게 하고, 무엇이든 오면 시간을 늦춘다', async () => {
      let push: (text: string) => void = () => {}
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          push = (text) => controller.enqueue(encoder.encode(text))
        },
      })
      setTransport(async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }))
      const finished = vi.fn()
      void streamMessages('/s', () => {}, signal()).then(finished)

      await vi.advanceTimersByTimeAsync(STREAM_STALL_MS - 1000)
      push(': ping\n\n')
      await vi.advanceTimersByTimeAsync(STREAM_STALL_MS - 1000)
      expect(finished).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1000)
      expect(finished).toHaveBeenCalledTimes(1)
    })
  })
})
