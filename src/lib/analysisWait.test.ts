// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { ANALYSIS_POLL_STOP_MS, ANALYSIS_SLOW_POLL_MS, analysisPollMs, isAnalysisOverdue } from './analysisWait'

const NOW = Date.parse('2026-11-05T01:00:00Z')
const ago = (ms: number) => ({ updatedAt: new Date(NOW - ms).toISOString() })

describe('오래 걸리는 분석', () => {
  it('1분 안에는 진행 중으로 보고 그 뒤에는 오래 걸린다고 본다', () => {
    expect(isAnalysisOverdue(ago(59_000), NOW)).toBe(false)
    expect(isAnalysisOverdue(ago(60_000), NOW)).toBe(true)
  })

  it('폴링은 처음에만 빠르고, 느려졌다가 멈춘다', () => {
    expect(analysisPollMs(ago(1_000), 1000, NOW)).toBe(1000)
    expect(analysisPollMs(ago(60_000), 1000, NOW)).toBe(ANALYSIS_SLOW_POLL_MS)
    expect(analysisPollMs(ago(ANALYSIS_POLL_STOP_MS), 1000, NOW)).toBe(false)
  })

  it('시각을 읽지 못하거나 먼 미래면 빠른 폴링을 끝없이 돌리지 않는다', () => {
    expect(analysisPollMs({ updatedAt: '모름' }, 1000, NOW)).toBe(false)
    expect(isAnalysisOverdue({ updatedAt: '모름' }, NOW)).toBe(true)
    expect(analysisPollMs(ago(-60 * 60_000), 1000, NOW)).toBe(false)
  })

  it('서버 시각이 조금 앞서도 방금 시작한 분석으로 본다', () => {
    expect(isAnalysisOverdue(ago(-3_000), NOW)).toBe(false)
    expect(analysisPollMs(ago(-3_000), 1000, NOW)).toBe(1000)
  })
})
