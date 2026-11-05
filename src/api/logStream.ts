import { requestsApi } from './endpoints'
import { isStreamDenied, POLL_AFTER_FAILURES, reconnectDelay, streamMessages } from './sse'
import type { LogLine } from './types'

export interface FollowLogsOptions {
  requestId: string
  /** 실행 중이면 끊겨도 다시 연결한다. 끝난 요청은 한 번 받고 멈춘다 */
  live: boolean
  signal: AbortSignal
  /** 마지막으로 받은 이벤트 ID. 다음 연결(실행 시작·종료로 live가 바뀐 경우 포함)에서 Last-Event-ID로 보낸다 */
  position: { current: string | undefined }
  onLine: (line: LogLine) => void
  /** ID 없이 다시 열렸다. 서버가 처음부터 다시 보내므로 지금까지 받은 줄을 비운다 */
  onRestart: () => void
  onConnection: (connected: boolean) => void
}

function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    signal.addEventListener('abort', finish)
  })
}

/** seq 순서를 지켜 한 줄을 넣는다. 스트림과 목록 API가 같은 줄을 어떤 순서로 줘도 화면은 같다. 이미 있으면 그대로 돌려준다. */
export function mergeLogLine(current: LogLine[], line: LogLine): LogLine[] {
  const at = current.findIndex((other) => other.seq >= line.seq)
  if (at === -1) return [...current, line]
  if (current[at].seq === line.seq) return current
  return [...current.slice(0, at), line, ...current.slice(at)]
}

/** 지난 줄은 목록 API만 보장한다(명세 3.5). 스트림이 다시 보내 주는지와 상관없이 여기서 읽는다. */
async function readAllLogs(requestId: string, onLine: (line: LogLine) => void, signal: AbortSignal) {
  let cursor: string | undefined
  do {
    const page = await requestsApi.logs(requestId, { cursor, limit: 100 })
    if (signal.aborted) return
    page?.items?.forEach(onLine)
    cursor = page?.nextCursor ?? undefined
  } while (cursor)
}

/**
 * 실행 로그를 받는다. 끝난 요청은 스트림을 한 번 받은 뒤 목록을 끝까지 읽고 멈춘다.
 * 실행 중이면 지난 줄을 목록에서 읽으면서 스트림을 잇는다. 끊기면 점점 긴 간격으로 다시 연결하고, 줄을 받으면 간격을 처음으로 되돌린다.
 * 401·403·404는 다시 연결해도 소용없어 호출한 쪽에 던진다. 연결이 계속 안 되면 목록 API로도 받는다.
 */
export async function followLogs({ requestId, live, signal, position, onLine, onRestart, onConnection }: FollowLogsOptions) {
  const deliver = (line: LogLine) => {
    if (typeof line?.seq === 'number') onLine(line)
  }
  let pastLoaded = false
  const loadPast = async () => {
    await readAllLogs(requestId, deliver, signal)
    pastLoaded = true
  }
  let failures = 0
  while (!signal.aborted) {
    let reason: unknown = null
    try {
      await streamMessages(
        `/requests/${requestId}/logs/stream`,
        (message) => {
          failures = 0
          // 깨진 메시지를 받아도 ID는 넘긴다. 다시 연결할 때 같은 메시지에서 또 멈추지 않게 한다.
          if (message.id !== null) position.current = message.id
          if (message.event !== 'heartbeat') deliver(JSON.parse(message.data) as LogLine)
        },
        signal,
        position.current,
        () => {
          onConnection(true)
          if (position.current !== undefined) return
          onRestart()
          // 비운 뒤에 읽어야 읽은 줄이 지워지지 않는다. 실패하면 끊겼을 때 다시 읽는다.
          if (live) void loadPast().catch(() => {})
        },
      )
    } catch (caught) {
      reason = caught
    }
    if (signal.aborted) return
    if (isStreamDenied(reason)) throw reason
    if (!live) {
      await loadPast()
      return
    }
    onConnection(false)
    failures += 1
    if (!pastLoaded || failures >= POLL_AFTER_FAILURES) {
      await loadPast().catch((polling: unknown) => {
        if (isStreamDenied(polling)) throw polling
      })
    }
    await waitFor(reconnectDelay(failures - 1), signal)
  }
}
