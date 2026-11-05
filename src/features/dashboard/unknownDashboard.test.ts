import { describe, expect, it } from 'vitest'
import type { Dashboard } from '../../api/types'
import { dashboardToShow, killAllVisible } from './unknownDashboard'

describe('집계를 받지 못한 대시보드', () => {
  it('실패하면 0이 아니라 모르는 값으로 채운다. 그래야 비상 버튼이 남는다', () => {
    expect(dashboardToShow(undefined, true, 'COMPANY')).toEqual({ scope: 'COMPANY', requestCount: null, pendingApprovalCount: null, riskCounts: null, statusCounts: null })
  })

  it('일괄 중단 버튼은 오류면 항상 보인다. 받아 둔 값이 실행 중 0건이어도 지금은 모른다', () => {
    const idle = { scope: 'COMPANY', statusCounts: { RUNNING: 0 } } as Dashboard
    expect(killAllVisible(undefined, true)).toBe(true)
    expect(killAllVisible(idle, true)).toBe(true)
  })

  it('일괄 중단 버튼은 평소에 실행 중이거나 건수를 모를 때만 보인다', () => {
    expect(killAllVisible(undefined, false)).toBe(false)
    expect(killAllVisible({ scope: 'COMPANY', statusCounts: { RUNNING: 0 } } as Dashboard, false)).toBe(false)
    expect(killAllVisible({ scope: 'COMPANY', statusCounts: { RUNNING: 2 } } as Dashboard, false)).toBe(true)
    expect(killAllVisible({ scope: 'COMPANY', statusCounts: null } as Dashboard, false)).toBe(true)
  })

  it('받는 중이면 아직 그리지 않는다', () => {
    expect(dashboardToShow(undefined, false, 'COMPANY')).toBeUndefined()
  })

  it('받은 값이 있으면 다시 받기에 실패해도 그대로 쓴다', () => {
    const data = { scope: 'ME', requestCount: 1 } as Dashboard
    expect(dashboardToShow(data, true, 'ME')).toBe(data)
  })
})
