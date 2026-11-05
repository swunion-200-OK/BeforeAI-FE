import { describe, expect, it } from 'vitest'
import type { RequestStatus, RequestSummary } from '../../api/types'
import { dashboardFromRequests, unknownDashboard } from './fallbackDashboard'

const request = (status: RequestStatus) => ({ status }) as RequestSummary

describe('집계 API가 없을 때의 대시보드', () => {
  it('받은 요청을 상태별로 센다', () => {
    const items = [request('RUNNING'), request('RUNNING'), request('COMPLETED')]
    const result = dashboardFromRequests('COMPANY', { items, nextCursor: null })
    expect(result.requestCount).toBe(3)
    expect(result.statusCounts).toEqual({ RUNNING: 2, COMPLETED: 1 })
  })

  it('목록에 없는 위험도와 승인 대기는 0이 아니라 모른다고 둔다', () => {
    const result = dashboardFromRequests('ME', { items: [request('RUNNING')], nextCursor: null })
    expect(result.riskDistribution).toBeNull()
    expect(result.pendingApprovalCount).toBeNull()
  })

  it('목록이 잘렸으면 일부만 센 숫자를 전체처럼 보여 주지 않는다', () => {
    const result = dashboardFromRequests('COMPANY', { items: [request('RUNNING')], nextCursor: 'more' })
    expect(result).toEqual(unknownDashboard('COMPANY'))
  })

  it('요청이 없으면 0건이다', () => {
    const result = dashboardFromRequests('ME', { items: [], nextCursor: null })
    expect(result.requestCount).toBe(0)
    expect(result.statusCounts).toEqual({})
  })
})
