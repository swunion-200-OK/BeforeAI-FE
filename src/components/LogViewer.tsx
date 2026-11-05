import { useEffect, useRef, useState } from 'react'
import { USE_MOCK } from '../api/client'
import { errorMessage } from '../api/errors'
import { useMe } from '../app/AuthProvider'
import { deviceStore } from '../crypto/deviceStore'
import { verifyLogLineSignature } from '../crypto/logSignature'
import { followLogs, logLineKey, mergeLogLine } from '../api/logStream'
import type { LogLine, LogRange } from '../api/types'

const time = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
const signatureCache = new WeakMap<LogLine, Map<string, boolean>>()

/** 시각이 없거나 잘못되면 Intl이 RangeError를 던져 화면 전체가 깨진다. */
function formatLogTime(at: string): string {
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? '' : time.format(date)
}

function verifyLogLine(requestId: string, line: LogLine, signingKey: string): boolean {
  let variants = signatureCache.get(line)
  if (!variants) {
    variants = new Map()
    signatureCache.set(line, variants)
  }
  const cacheKey = JSON.stringify([requestId, signingKey, line.sequence, line.at, line.taskId, line.message, line.webshellSignature])
  const cached = variants.get(cacheKey)
  if (cached !== undefined) return cached

  const verified = verifyLogLineSignature(requestId, line, signingKey)
  variants.set(cacheKey, verified)
  return verified
}

/** 실행 로그: 터미널 모양, 읽기 전용. SSE로 실시간으로 이어 받는다. range를 주면 그 구간만 보여 준다. */
export function LogViewer({ requestId, live, range }: { requestId: string; live: boolean; range?: LogRange }) {
  const me = useMe()
  const [received, setLines] = useState<LogLine[]>([])
  const lines = range ? received.filter((l) => l.sequence >= range.from && (range.to === null || l.sequence <= range.to)) : received
  // The mock signs { requestId, sequence, at, taskId, message }. The live API
  // does not define the signed bytes, so a failed local assumption must not be
  // presented as a tampered server log.
  const signingKey = USE_MOCK ? deviceStore.get(me.id).pinnedWebshellKey?.signing.publicKey : undefined
  const checkedLines = lines.map((line) => ({
    line,
    verified: signingKey ? verifyLogLine(requestId, line, signingKey) : null,
  }))
  const failedLines = checkedLines.filter(({ verified }) => verified === false).length
  const hasInvalidSignature = failedLines > 0
  const [error, setError] = useState<string | null>(null)
  const [connection, setConnection] = useState<'open' | 'dropped' | 'closed'>('closed')
  const bodyRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  useEffect(() => {
    setLines([])
  }, [requestId])

  // 실행이 시작되거나 끝나면(live) 다시 읽는다. 같은 줄은 겹치지 않는다.
  useEffect(() => {
    const controller = new AbortController()
    setError(null)
    setConnection('open')
    followLogs({
      requestId,
      live,
      signal: controller.signal,
      onLine: (line) => setLines((current) => mergeLogLine(current, line)),
      onConnection: (connected) => setConnection(connected ? 'open' : 'dropped'),
    })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(errorMessage(reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setConnection('closed')
      })
    return () => controller.abort()
  }, [requestId, live])

  useEffect(() => {
    const body = bodyRef.current
    if (body && stickToBottom.current) body.scrollTop = body.scrollHeight
  }, [lines])

  return (
    <div className="overflow-hidden rounded-xl bg-terminal">
      <div className="flex items-center justify-between border-b border-terminal-2 px-4 py-2 text-sm text-terminal-dim">
        <span>실행 로그 (읽기 전용)</span>
        <div className="flex items-center gap-3">
          <span className={!USE_MOCK || !signingKey || hasInvalidSignature ? 'text-[#ffca85]' : lines.length === 0 ? 'text-terminal-dim' : 'text-[#7ddc9f]'}>
            {!USE_MOCK
              ? '서명 규칙 미정'
              : !signingKey
                ? '서명 미검증'
                : hasInvalidSignature
                  ? `서명 확인 실패 ${failedLines}줄`
                  : lines.length === 0
                    ? '서명 확인 대기'
                    : '표시된 줄의 서명 확인됨'}
          </span>
          {live && connection === 'open' && <span className="text-[#7ddc9f]">실시간 수신 중</span>}
          {live && connection === 'dropped' && <span>연결이 끊겨 다시 연결하는 중</span>}
        </div>
      </div>
      {!USE_MOCK && lines.length > 0 && (
        <p role="status" className="border-b border-terminal-2 px-4 py-2 text-sm text-[#ffca85]">
          백엔드가 서명 대상 형식을 정의하지 않아 로그 서명을 확인할 수 없습니다. 로그 내용은 미검증 상태입니다.
        </p>
      )}
      {USE_MOCK && !signingKey && lines.length > 0 && (
        <p role="status" className="border-b border-terminal-2 px-4 py-2 text-sm text-[#ffca85]">
          이 기기에 고정된 웹쉘 공개키가 없어 서명을 확인하지 못했습니다. 로그 내용은 검증되지 않았습니다.
        </p>
      )}
      {hasInvalidSignature && (
        <p role="alert" className="border-b border-terminal-2 px-4 py-2 text-sm text-[#ff8f85]">
          웹쉘 서명 확인에 실패한 로그 {failedLines}줄은 내용을 숨겼습니다.
        </p>
      )}
      <div
        ref={bodyRef}
        role="log"
        aria-live="off"
        tabIndex={0}
        onScroll={(event) => {
          const el = event.currentTarget
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        className="quiet-scroll max-h-96 min-h-32 overflow-y-auto p-4 font-mono text-sm leading-6"
      >
        {lines.length === 0 && !error && <p className="text-terminal-dim">아직 실행 로그가 없습니다.</p>}
        {checkedLines.map(({ line, verified }) => (
          <div key={logLineKey(line)} className="flex gap-3">
            <span className="shrink-0 text-terminal-dim select-none">{formatLogTime(line.at)}</span>
            {verified === false ? (
              <span className="text-[#ff8f85]">웹쉘 서명 실패 (내용 숨김)</span>
            ) : (
              <span className="break-all whitespace-pre-wrap text-terminal-ink">
                {line.message}
                {verified === null && <span className="ml-2 text-[#ffca85]">(미검증)</span>}
              </span>
            )}
          </div>
        ))}
        {error && <p className="mt-2 text-[#ff8f85]">{error}</p>}
      </div>
    </div>
  )
}
