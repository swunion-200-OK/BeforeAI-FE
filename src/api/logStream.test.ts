// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setTransport } from './client'
import { followLogs, mergeLogLine } from './logStream'
import { RECONNECT_BASE_MS, RECONNECT_MAX_MS } from './sse'
import type { LogLine } from './types'

const line = (seq: number) => ({ seq, at: '2026-11-05T00:00:00Z', level: 'INFO', taskId: null, text: `줄 ${seq}`, webshellSignature: '' })
const frame = (seq: number, id = true) => `${id ? `id: ${seq}\n` : ''}data: ${JSON.stringify(line(seq))}\n\n`
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

function setup(replies: Array<(signal?: AbortSignal | null) => Response | Promise<Response>>, options: { live?: boolean; list?: () => Response; position?: string } = {}) {
  const controller = new AbortController()
  const position: { current: string | undefined } = { current: options.position }
  const lines: LogLine[] = []
  const lastIds: Array<string | undefined> = []
  const onRestart = vi.fn()
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
    position,
    onLine: (value) => lines.push(value),
    onRestart,
    onConnection,
  })
  return { controller, position, lines, lastIds, onRestart, onConnection, list, opened, done }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('실행 로그 잇기', () => {
  it('서버가 닫으면 간격을 두고 마지막 ID로 이어 받고, 다시 받을 때 줄을 비우지 않는다', async () => {
    const t = setup([() => stream(frame(1), frame(2)), () => stream(frame(3))])
    await vi.advanceTimersByTimeAsync(0)
    expect(t.lines.map((l) => l.seq)).toEqual([1, 2])
    expect(t.opened).toHaveBeenCalledTimes(1)
    expect(t.onConnection).toHaveBeenLastCalledWith(false)
    await vi.advanceTimersByTimeAsync(RECONNECT_BASE_MS)
    expect(t.lastIds).toEqual([undefined, '2'])
    expect(t.lines.map((l) => l.seq)).toEqual([1, 2, 3])
    expect(t.onRestart).toHaveBeenCalledTimes(1)
    t.controller.abort()
    await t.done
  })

  it('서버가 ID를 주지 않으면 다시 열 때 처음부터 받도록 비운다', async () => {
    const t = setup([() => stream(frame(1, false)), hanging])
    await vi.advanceTimersByTimeAsync(RECONNECT_BASE_MS)
    expect(t.lastIds).toEqual([undefined, undefined])
    expect(t.onRestart).toHaveBeenCalledTimes(2)
    t.controller.abort()
    await t.done
  })

  it('실패가 이어지면 간격을 늘리되 상한을 넘지 않고, 줄을 받으면 처음으로 돌아간다', async () => {
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

  it('heartbeat와 깨진 메시지는 줄로 만들지 않고, 깨진 메시지의 ID는 넘긴다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const t = setup([() => stream('event: heartbeat\ndata: {"at":"x"}\n\n', 'id: 5\ndata: {깨짐\n\n', 'data: {"seq":"없음"}\n\n', frame(6))])
    await vi.advanceTimersByTimeAsync(0)
    expect(t.lines.map((l) => l.seq)).toEqual([6])
    expect(t.position.current).toBe('6')
    t.controller.abort()
    await t.done
    warn.mockRestore()
  })

  it('끝난 요청은 한 번 받고 멈춘다', async () => {
    const t = setup([() => stream(frame(1))], { live: false })
    await t.done
    await vi.advanceTimersByTimeAsync(RECONNECT_MAX_MS * 2)
    expect(t.opened).toHaveBeenCalledTimes(1)
    expect(t.list).toHaveBeenCalledTimes(1)
    expect(t.lines.map((l) => l.seq)).toEqual([1])
  })
})

describe('지난 줄은 목록 API에서 읽는다', () => {
  const pastLines = () => json(200, { items: [line(1), line(2)], nextCursor: null })

  it('끝난 요청을 스트림이 다시 보내 주지 않고 닫아도 지난 줄을 보여 준다', async () => {
    const t = setup([() => stream()], { live: false, list: pastLines })
    await t.done
    expect(t.lines.map((l) => l.seq)).toEqual([1, 2])
    expect(t.onRestart.mock.invocationCallOrder[0]).toBeLessThan(t.list.mock.invocationCallOrder[0])
  })

  it('끝난 요청에서 목록이 비어 있는 답을 줘도 멈추지 않는다', async () => {
    const t = setup([() => stream()], { live: false, list: () => new Response('', { status: 200 }) })
    await expect(t.done).resolves.toBeUndefined()
  })

  it('목록에 깨진 줄이 있어도 넘기지 않는다', async () => {
    const t = setup([() => stream()], { live: false, list: () => json(200, { items: [{ text: 'seq 없음' }, line(1)], nextCursor: null }) })
    await t.done
    expect(t.lines.map((l) => l.seq)).toEqual([1])
  })

  it('실행 중이면 스트림을 연 직후 비운 다음 지난 줄을 읽고, 연결이 살아 있는 동안 또 읽지 않는다', async () => {
    const t = setup([hanging], { list: pastLines })
    await vi.advanceTimersByTimeAsync(RECONNECT_MAX_MS)
    expect(t.lines.map((l) => l.seq)).toEqual([1, 2])
    expect(t.list).toHaveBeenCalledTimes(1)
    expect(t.onRestart.mock.invocationCallOrder[0]).toBeLessThan(t.list.mock.invocationCallOrder[0])
    t.controller.abort()
    await t.done
  })

  it('실행 중에 처음 연결이 안 돼도 첫 실패에서 바로 지난 줄을 읽는다', async () => {
    const t = setup([() => json(502, {}), hanging], { list: pastLines })
    await vi.advanceTimersByTimeAsync(0)
    expect(t.opened).toHaveBeenCalledTimes(1)
    expect(t.lines.map((l) => l.seq)).toEqual([1, 2])
    t.controller.abort()
    await t.done
  })

  it('처음 읽기가 실패하면 끊겼을 때 다시 읽는다', async () => {
    const replies = [json(503, {}), json(200, { items: [line(1)], nextCursor: null })]
    const t = setup([() => stream(), hanging], { list: () => replies.shift() as Response })
    await vi.advanceTimersByTimeAsync(0)
    expect(t.list).toHaveBeenCalledTimes(2)
    expect(t.lines.map((l) => l.seq)).toEqual([1])
    t.controller.abort()
    await t.done
  })

  it('ID로 이어 받으면 비우지 않고, 실행 중 연결이 살아 있으면 목록을 읽지 않는다', async () => {
    const t = setup([hanging], { list: pastLines, position: '7' })
    await vi.advanceTimersByTimeAsync(0)
    expect(t.lastIds).toEqual(['7'])
    expect(t.onRestart).not.toHaveBeenCalled()
    expect(t.list).not.toHaveBeenCalled()
    t.controller.abort()
    await t.done
  })
})

describe('줄 합치기', () => {
  const seqs = (lines: LogLine[]) => lines.map((l) => l.seq)
  const lines = (...values: number[]) => values.map(line) as LogLine[]

  it('뒤에 붙이고, 먼저 온 스트림 줄 앞으로 지난 줄을 끼워 넣는다', () => {
    expect(seqs(mergeLogLine(lines(1), line(2) as LogLine))).toEqual([1, 2])
    expect(seqs(mergeLogLine(lines(5, 6), line(1) as LogLine))).toEqual([1, 5, 6])
    expect(seqs(mergeLogLine(lines(1, 5), line(3) as LogLine))).toEqual([1, 3, 5])
  })

  it('이미 있는 줄이면 같은 배열을 돌려줘 다시 그리지 않는다', () => {
    const current = lines(1, 2)
    expect(mergeLogLine(current, line(2) as LogLine)).toBe(current)
  })
})

describe('스트림을 못 쓸 때 목록 API로 받기', () => {
  it('끝난 요청은 스트림 실패 시 목록을 끝까지 읽어 오류 없이 보여 준다', async () => {
    const pages = [json(200, { items: [line(1)], nextCursor: 'c' }), json(200, { items: [line(2)], nextCursor: null })]
    const t = setup([() => json(500, {})], { live: false, list: () => pages.shift() as Response })
    await t.done
    expect(t.lines.map((l) => l.seq)).toEqual([1, 2])
  })

  it('끝난 요청의 목록도 실패하면 그 오류를 알린다', async () => {
    const t = setup([() => json(500, {})], { live: false, list: () => json(500, { error: { code: 'X', message: '실패' } }) })
    await expect(t.done).rejects.toMatchObject({ status: 500 })
  })

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
    // 실패한 두 번마다 읽고, 세 번째 연결이 ID 없이 열려 비운 뒤 또 읽는다.
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
