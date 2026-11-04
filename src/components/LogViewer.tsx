import { useEffect, useRef, useState } from 'react'
import { errorMessage } from '../api/errors'
import { requestsApi } from '../api/endpoints'
import type { LogLevel, LogLine } from '../api/types'

const LEVEL_CLASS: Record<LogLevel, string> = {
  INFO: 'text-terminal-ink',
  CMD: 'text-[#8ab4ff]',
  ERROR: 'text-[#ff8f85]',
  SUCCESS: 'text-[#7ddc9f]',
}

const time = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

/** 실행 로그: 터미널 모양, 읽기 전용. SSE로 실시간으로 이어 받는다. */
export function LogViewer({ requestId, live }: { requestId: string; live: boolean }) {
  const [lines, setLines] = useState<LogLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const [streaming, setStreaming] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  // 스트림이 끊기면(초기화·네트워크) 처음부터 다시 받는다. 서버가 지난 로그를 다시 보내 준다.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let retry: ReturnType<typeof setTimeout> | undefined
    setLines([])
    setError(null)
    setStreaming(true)
    requestsApi
      .streamLogs(
        requestId,
        (line) => setLines((current) => (current.some((l) => l.seq === line.seq) ? current : [...current, line])),
        controller.signal,
      )
      .catch((reason) => {
        if (!controller.signal.aborted) setError(errorMessage(reason))
      })
      .finally(() => {
        if (controller.signal.aborted) return
        setStreaming(false)
        if (live) retry = setTimeout(() => setAttempt((n) => n + 1), 1500)
      })
    return () => {
      controller.abort()
      clearTimeout(retry)
    }
    // 실행이 시작되면(live) 다시 연결해 이어 받는다.
  }, [requestId, live, attempt])

  useEffect(() => {
    const body = bodyRef.current
    if (body && stickToBottom.current) body.scrollTop = body.scrollHeight
  }, [lines])

  return (
    <div className="overflow-hidden rounded-xl bg-terminal">
      <div className="flex items-center justify-between border-b border-terminal-2 px-3 py-1.5 text-xs text-terminal-dim">
        <span>실행 로그 (읽기 전용)</span>
        {streaming && live && <span className="text-[#7ddc9f]">실시간 수신 중</span>}
      </div>
      <div
        ref={bodyRef}
        role="log"
        aria-live="off"
        tabIndex={0}
        onScroll={(event) => {
          const el = event.currentTarget
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        className="quiet-scroll h-80 overflow-y-auto p-3 font-mono text-xs leading-5"
      >
        {lines.length === 0 && !error && <p className="text-terminal-dim">아직 실행 로그가 없습니다.</p>}
        {lines.map((line) => (
          <div key={line.seq} className="flex gap-3">
            <span className="shrink-0 text-terminal-dim select-none">{time.format(new Date(line.at))}</span>
            <span className={`break-all whitespace-pre-wrap ${LEVEL_CLASS[line.level]}`}>{line.text}</span>
          </div>
        ))}
        {error && <p className="mt-2 text-[#ff8f85]">{error}</p>}
      </div>
    </div>
  )
}
