import { requestsApi } from './endpoints'
import { isStreamDenied, POLL_AFTER_FAILURES, reconnectDelay } from './sse'
import type { LogLine } from './types'

export interface FollowLogsOptions {
  requestId: string
  /** 실행 중이면 스트림을 잇는다. 끝난 요청은 목록만 읽고 멈춘다 */
  live: boolean
  signal: AbortSignal
  onLine: (line: LogLine) => void
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

/** sequence는 실행 세션 안에서만 유일하다(ExecutionLog 유니크 제약). 재시도로 세션이 바뀌면 같은 번호가 또 나오므로 시각과 서명까지 본다. */
export function logLineKey(line: LogLine): string {
  return `${line.sequence}|${line.at}|${line.webshellSignature}`
}

const timeOf = (line: LogLine) => {
  const time = Date.parse(line.at)
  return Number.isNaN(time) ? 0 : time
}

/** 뒤의 줄인지. 서버 목록은 세션 순, sequence 순인데 세션 ID가 응답에 없어 시각으로 세션을 가른다. */
const comesAfter = (other: LogLine, line: LogLine) => {
  const gap = timeOf(other) - timeOf(line)
  return gap !== 0 ? gap > 0 : other.sequence > line.sequence
}

/** 순서를 지켜 한 줄을 넣는다. 스트림과 목록 API가 같은 줄을 어떤 순서로 줘도 화면은 같다. 이미 있으면 그대로 돌려준다. */
export function mergeLogLine(current: LogLine[], line: LogLine): LogLine[] {
  const key = logLineKey(line)
  if (current.some((other) => logLineKey(other) === key)) return current
  const at = current.findIndex((other) => comesAfter(other, line))
  if (at === -1) return [...current, line]
  return [...current.slice(0, at), line, ...current.slice(at)]
}

/** 지난 줄은 목록 API로만 읽을 수 있다. 서버 스트림은 연결한 뒤의 줄만 보내고 Last-Event-ID도 받지 않는다. */
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
 * 실행 로그를 받는다. 서버 스트림은 스스로 닫히지 않으므로 끝난 요청은 스트림을 열지 않고 목록만 읽는다.
 * 실행 중이면 스트림을 열 때마다 목록을 다시 읽어 끊긴 사이의 줄을 채운다. 끊기면 점점 긴 간격으로 다시 연결하고, 줄을 받으면 간격을 처음으로 되돌린다.
 * 401·403·404는 다시 연결해도 소용없어 호출한 쪽에 던진다. 연결이 계속 안 되면 목록 API로도 받는다.
 */
export async function followLogs({ requestId, live, signal, onLine, onConnection }: FollowLogsOptions) {
  const deliver = (line: LogLine) => {
    if (typeof line?.sequence === 'number') onLine(line)
  }
  if (!live) {
    await readAllLogs(requestId, deliver, signal)
    return
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
      await requestsApi.streamLogs(
        requestId,
        (line) => {
          failures = 0
          onLine(line)
        },
        signal,
        () => {
          onConnection(true)
          // 연결이 열린 뒤에 읽어야 그 사이에 나온 줄을 놓치지 않는다. 실패하면 끊겼을 때 다시 읽는다.
          void loadPast().catch(() => {})
        },
      )
    } catch (caught) {
      reason = caught
    }
    if (signal.aborted) return
    if (isStreamDenied(reason)) throw reason
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
