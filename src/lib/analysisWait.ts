import { useEffect, useState } from 'react'
import type { RequestSummary } from '../api/types'

/** 이만큼 지나도 분석이 안 끝나면 진행 중이라고 말하지 않는다. */
export const ANALYSIS_OVERDUE_MS = 60_000
/** 오래 걸리는 분석은 이 간격으로만 다시 읽는다. */
export const ANALYSIS_SLOW_POLL_MS = 30_000
/** 여기까지 지나면 자동으로 읽지 않는다. 창으로 돌아오거나 "지금 다시 확인"을 누를 때만 읽는다. */
export const ANALYSIS_POLL_STOP_MS = 10 * 60_000
/** 서버 시각이 조금 앞서는 정도는 봐 주고, 이보다 미래면 시계를 믿을 수 없다고 본다. */
const CLOCK_SKEW_MS = 5 * 60_000

type Since = Pick<RequestSummary, 'updatedAt'>

/**
 * 분석을 시작한 뒤 지난 시간. 재분석은 만든 지 오래된 요청에서도 시작되므로 createdAt이 아니라 상태가 바뀐 시각(updatedAt)으로 잰다.
 * 서버는 분석 중에 요청을 달리 고치지 않는다. 시각을 읽지 못하면 오래된 것으로 봐서 폴링이 끝없이 빠르게 돌지 않게 한다.
 */
function elapsedMs({ updatedAt }: Since, now: number): number {
  const elapsed = now - Date.parse(updatedAt)
  return Number.isNaN(elapsed) || elapsed < -CLOCK_SKEW_MS ? Number.POSITIVE_INFINITY : elapsed
}

export function isAnalysisOverdue(request: Since, now = Date.now()): boolean {
  return elapsedMs(request, now) >= ANALYSIS_OVERDUE_MS
}

/** 분석 중인 요청을 얼마 만에 다시 읽을지. 처음에는 fastMs, 오래 걸리면 느리게, 더 지나면 멈춘다. */
export function analysisPollMs(request: Since, fastMs: number, now = Date.now()): number | false {
  const elapsed = elapsedMs(request, now)
  if (elapsed < ANALYSIS_OVERDUE_MS) return fastMs
  if (!Number.isFinite(elapsed) || elapsed >= ANALYSIS_POLL_STOP_MS) return false
  return ANALYSIS_SLOW_POLL_MS
}

/**
 * 시간이 지나 오래 걸리는 상태로 넘어갈 때 화면을 다시 그린다. 폴링 결과가 같으면 다시 그려지지 않으므로 타이머가 필요하다.
 * 분석 중이 아니면 false다.
 */
export function useAnalysisOverdue(request: Since & Pick<RequestSummary, 'status'>): boolean {
  const since = request.status === 'ANALYZING' ? request.updatedAt : null
  const [overdueSince, setOverdueSince] = useState<string | null>(null)
  useEffect(() => {
    if (since === null) return
    const left = ANALYSIS_OVERDUE_MS - elapsedMs({ updatedAt: since }, Date.now())
    const timer = setTimeout(() => setOverdueSince(since), Math.max(0, left))
    return () => clearTimeout(timer)
  }, [since])
  return since !== null && overdueSince === since
}
