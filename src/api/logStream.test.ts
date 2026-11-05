// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setTransport } from './client'
import { followLogs, mergeLogLine } from './logStream'
import { RECONNECT_BASE_MS, RECONNECT_MAX_MS } from './sse'
import type { LogLine } from './types'

const line = (sequence: number, at = '2026-11-05T00:00:00Z'): LogLine => ({
  sequence,
  at,
  taskId: null,
  message: `줄 ${sequence}`,
  webshellSignature: `sig-${sequence}-${at}`,
})
/** 서버 스트림 그대로: 이벤트 이름은 log이고 id가 없다 (RequestStreamService.publishLog) */
const frame = (sequence: number) => `event:log\ndata:${JSON.stringify(line(sequence))}\n\n`
const stream = (...frames: string[]) => new Response(frames.join(''), { headers: { 'Content-Type': 'text/event-stream' } })
/** 실제 fetch처럼 중단하면 본문이 오류로 끝나는, 아무것도 보내지 않는 스트림 */
const hanging = (signal?: AbortSignal | null) =>
  new Response(
    new ReadableStream({
      start(controller) {
        signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')))
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

function setup(replies: Array<(signal?: AbortSignal | null) => Response | Promise<Response>>, options: { live?: boolean; list?: () => Response } = {}) {
  const controller = new AbortController()
  const lines: LogLine[] = []
  const lastIds: Array<string | undefined> = []
  const onConnection = vi.fn()
  const list = vi.fn(options.list ?? (() => json(200, { items: [], nextCursor: null })))
  const opened = vi.fn(async (_url: string, init: RequestInit) => {
    lastIds.push((init.headers as Record<string, string>)['Last-Event-ID'])
    const reply = replies.shift()
    return reply ? reply(init.signal) : hanging(init.signal)
  })
  setTransport(async (url, init) => (url.includes('/logs/stream') ? opened(url, init) : list()))
  const done = followLogs({
    requestId: 'r',
    live: options.live ?? true,
    signal: controller.signal,
    onLine: (value) => lines.push(value),
    onConnection,
  })
  return { controller, lines, lastIds, onConnection, list, opened, done }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('실행 로그 잇기', () => {
  it('서버가 끊으면 간격을 두고 다시 연결하고, 서버가 받지 않는 Last-Event-ID는 보내지 않는다', async () => {
    const t = setup([() => stream(frame(1), frame(2)), () => stream(frame(3))])
    await vi.advanceTimersByTimeAsync(0)
    expect(t.lines.map((l) => l.sequence)).toEqual([1, 2])
    expect(t.opened).toHaveBeenCalledTimes(1)
    expect(t.onConnection).toHaveBeenLastCalledWith(false)
    await vi.advanceTimersByTimeAsync(RECONNECT_BASE_MS)
    expect(t.lastIds).toEqual([undefined, undefined])
    expect(t.lines.map((l) => l.sequence)).toEqual([1, 2, 3])
    t.controller.abort()
    await t.done
  })

  it('실패가 이어지면 간격을 늘리되 상한을 넘지 않는다', async () => {
    const down = () => json(500, {})
    const t = setup(Array.from({ length: 9 }, () => down))
    const delays: number[] = []
    await vi.advanceTimersByTimeAsync(0)
    for (let i = 0; i < 8; i++) {
      const before = t.opened.mock.calls.length
      let waited = 0
      while (t.opened.mock.calls.length === before) {
        await vi.advanceTimersByTimeAsync(500)
        waited += 500
      }
      delays.push(waited)
    }
    expect(delays.slice(0, 3)).toEqual([RECONNECT_BASE_MS, RECONNECT_BASE_MS * 2, RECONNECT_BASE_MS * 4])
    expect(delays.at(-1)).toBe(RECONNECT_MAX_MS)
    t.controller.abort()
    await t.done
  })

  it.each([401, 403, 404])('%i이면 멈추고 호출한 쪽에 알린다', async (status) => {
    const t = setup([() => json(status, { error: { code: 'X', message: '막힘' } })])
    await expect(t.done).rejects.toMatchObject({ status })
    await vi.advanceTimersByTimeAsync(RECONNECT_MAX_MS * 2)
    expect(t.opened).toHaveBeenCalledTimes(1)
  })

  it('중단하면 기다리던 재연결도 멈춘다', async () => {
    const t = setup([() => stream()])
    await vi.advanceTimersByTimeAsync(0)
    t.controller.abort()
    await t.done
    await vi.advanceTimersByTimeAsync(RECONNECT_MAX_MS * 2)
    expect(t.opened).toHaveBeenCalledTimes(1)
  })

  it('log 이벤트만 줄로 만든다. 주석 heartbeat, 다른 이벤트, 깨진 메시지는 넘어간다', async () => {
    const t = setup([
      () => stream(':heartbeat\n\n', 'event:other\ndata:{"sequence":9}\n\n', 'event:log\ndata:{깨짐\n\n', 'event:log\ndata:{"sequence":"없음"}\n\n', frame(6)),
    ])
    await vi.advanceTimersByTimeAsync(0)
    expect(t.lines.map((l) => l.sequence)).toEqual([6])
    t.controller.abort()
    await t.done
  })
})

describe('지난 줄은 목록 API에서 읽는다', () => {
  const pastLines = () => json(200, { items: [line(1), line(2)], nextCursor: null })

  it('끝난 요청은 스트림을 열지 않는다. 서버 스트림은 스스로 닫히지 않아 열면 영영 기다린다', async () => {
    const t = setup([hanging], { live: false, list: pastLines })
    await t.done
    expect(t.opened).not.toHaveBeenCalled()
    expect(t.lines.map((l) => l.sequence)).toEqual([1, 2])
  })

  it('끝난 요청의 목록을 끝까지 읽는다', async () => {
    const pages = [json(200, { items: [line(1)], nextCursor: 'c' }), json(200, { items: [line(2)], nextCursor: null })]
    const t = setup([], { live: false, list: () => pages.shift() as Response })
    await t.done
    expect(t.lines.map((l) => l.sequence)).toEqual([1, 2])
  })

  it('끝난 요청에서 목록이 비어 있는 답을 줘도 멈추지 않는다', async () => {
    const t = setup([], { live: false, list: () => new Response('', { status: 200 }) })
    await expect(t.done).resolves.toBeUndefined()
  })

  it('끝난 요청의 목록이 실패하면 그 오류를 알린다', async () => {
    const t = setup([], { live: false, list: () => json(500, { error: { code: 'X', message: '실패' } }) })
    await expect(t.done).rejects.toMatchObject({ status: 500 })
  })

  it('목록에 깨진 줄이 있어도 넘기지 않는다', async () => {
    const t = setup([], { live: false, list: () => json(200, { items: [{ message: 'sequence 없음' }, line(1)], nextCursor: null }) })
    await t.done
    expect(t.lines.map((l) => l.sequence)).toEqual([1])
  })

  it('실행 중이면 스트림을 연 직후 지난 줄을 읽고, 연결이 살아 있는 동안 또 읽지 않는다', async () => {
    const t = setup([hanging], { list: pastLines })
    await vi.advanceTimersByTimeAsync(RECONNECT_MAX_MS)
    expect(t.lines.map((l) => l.sequence)).toEqual([1, 2])
    expect(t.list).toHaveBeenCalledTimes(1)
    t.controller.abort()
    await t.done
  })

  it('서버는 지난 줄을 다시 보내지 않으므로 다시 연결할 때마다 목록을 읽어 끊긴 사이를 채운다', async () => {
    const t = setup([() => stream(), hanging], { list: pastLines })
    await vi.advanceTimersByTimeAsync(RECONNECT_BASE_MS)
    expect(t.opened).toHaveBeenCalledTimes(2)
    // 첫 연결이 바로 끊겨 처음 읽기가 끝나기 전이면 한 번 더 읽는다. 다시 연 뒤의 읽기가 있는지만 본다.
    expect(t.list.mock.calls.length).toBeGreaterThanOrEqual(2)
    t.controller.abort()
    await t.done
  })

  it('실행 중에 처음 연결이 안 돼도 첫 실패에서 바로 지난 줄을 읽는다', async () => {
    const t = setup([() => json(502, {}), hanging], { list: pastLines })
    await vi.advanceTimersByTimeAsync(0)
    expect(t.opened).toHaveBeenCalledTimes(1)
    expect(t.lines.map((l) => l.sequence)).toEqual([1, 2])
    t.controller.abort()
    await t.done
  })

  it('처음 읽기가 실패하면 끊겼을 때 다시 읽는다', async () => {
    const replies = [json(503, {}), json(200, { items: [line(1)], nextCursor: null })]
    const t = setup([() => stream(), hanging], { list: () => replies.shift() as Response })
    await vi.advanceTimersByTimeAsync(0)
    expect(t.list).toHaveBeenCalledTimes(2)
    expect(t.lines.map((l) => l.sequence)).toEqual([1])
    t.controller.abort()
    await t.done
  })
})

describe('줄 합치기', () => {
  const seqs = (lines: LogLine[]) => lines.map((l) => l.sequence)
  const lines = (...values: number[]) => values.map((value) => line(value))

  it('뒤에 붙이고, 먼저 온 스트림 줄 앞으로 지난 줄을 끼워 넣는다', () => {
    expect(seqs(mergeLogLine(lines(1), line(2)))).toEqual([1, 2])
    expect(seqs(mergeLogLine(lines(5, 6), line(1)))).toEqual([1, 5, 6])
    expect(seqs(mergeLogLine(lines(1, 5), line(3)))).toEqual([1, 3, 5])
  })

  it('이미 있는 줄이면 같은 배열을 돌려줘 다시 그리지 않는다', () => {
    const current = lines(1, 2)
    expect(mergeLogLine(current, line(2))).toBe(current)
  })

  it('sequence는 실행 세션마다 다시 시작하므로, 재시도한 세션의 같은 번호를 지우지 않고 시각 순으로 뒤에 둔다', () => {
    const first = [line(1, '2026-11-05T00:00:00Z'), line(2, '2026-11-05T00:00:01Z')]
    const retried = line(1, '2026-11-05T01:00:00Z')
    expect(mergeLogLine(first, retried)).toEqual([...first, retried])
    // 서버의 나노초 자리가 있어도 시각으로 비교한다.
    const earlier = line(3, '2026-11-05T00:00:00.5Z')
    expect(mergeLogLine(first, earlier).map((l) => l.sequence)).toEqual([1, 3, 2])
  })
})

describe('스트림을 못 쓸 때 목록 API로 받기', () => {
  it('실행 중이면 지난 줄을 읽은 뒤에는 세 번째 실패부터 다시 연결할 때마다 읽는다', async () => {
    const down = () => json(502, {})
    const t = setup([down, down, down, down, hanging])
    await vi.advanceTimersByTimeAsync(0)
    expect(t.list).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(RECONNECT_BASE_MS)
    expect(t.opened).toHaveBeenCalledTimes(2)
    expect(t.list).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(RECONNECT_BASE_MS * 2)
    expect(t.opened).toHaveBeenCalledTimes(3)
    expect(t.list).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(RECONNECT_BASE_MS * 4)
    expect(t.list).toHaveBeenCalledTimes(3)
    t.controller.abort()
    await t.done
  })

  it('목록이 실패해도 다시 연결을 멈추지 않는다', async () => {
    const down = () => json(502, {})
    const t = setup([down, down, hanging], { list: () => json(503, {}) })
    await vi.advanceTimersByTimeAsync(RECONNECT_BASE_MS + RECONNECT_BASE_MS * 2)
    expect(t.opened).toHaveBeenCalledTimes(3)
    // 실패한 두 번마다 읽고, 세 번째 연결이 열린 뒤 또 읽는다.
    expect(t.list).toHaveBeenCalledTimes(3)
    t.controller.abort()
    await t.done
  })

  it('목록에서 권한이 없다고 하면 멈춘다', async () => {
    const down = () => json(502, {})
    const t = setup([down, down, down], { list: () => json(404, { error: { code: 'NOT_FOUND', message: 'x' } }) })
    const failed = expect(t.done).rejects.toMatchObject({ status: 404 })
    await vi.advanceTimersByTimeAsync(RECONNECT_BASE_MS * 3)
    await failed
  })
})
