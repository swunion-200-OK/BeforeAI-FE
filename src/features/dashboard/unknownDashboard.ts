import type { Dashboard, DashboardScope } from '../../api/types'

/**
 * 집계를 받지 못했을 때 보여 줄 대시보드. 모르는 값은 null이라 화면이 0건과 구별해 "-"로 보여 준다.
 * 받은 값이 없고 실패했으면 이것을 써서, 숫자만 비우고 일괄 중단 버튼과 목록은 남긴다.
 */
/** 일괄 중단 버튼. 건수를 모르거나 집계를 다시 받지 못하면 실행 중인데도 못 멈추는 일이 없도록 보여 준다. */
export function killAllVisible(data: Dashboard | undefined, isError: boolean): boolean {
  if (isError) return true
  return Boolean(data) && (!data?.statusCounts || (data.statusCounts.RUNNING ?? 0) > 0)
}

export function dashboardToShow(data: Dashboard | undefined, failed: boolean, scope: DashboardScope): Dashboard | undefined {
  if (data) return data
  return failed ? { scope, requestCount: null, pendingApprovalCount: null, riskCounts: null, statusCounts: null } : undefined
}
