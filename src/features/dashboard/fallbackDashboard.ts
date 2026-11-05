import type { Dashboard, DashboardScope, Page, RequestStatus, RequestSummary } from '../../api/types'

/** 모르는 값은 null이다. 화면이 0건과 구별해 "-"로 보여 준다. */
export function unknownDashboard(scope: DashboardScope): Dashboard {
  return { scope, requestCount: null, pendingApprovalCount: null, riskDistribution: null, statusCounts: null }
}

/**
 * GET /dashboard가 서버에 없는 동안 쓰는 집계 (api/missingOnServer.ts). 조회 권한 안의 요청 목록을 센다.
 * 목록이 상한에서 잘렸으면 일부만 센 숫자를 전체처럼 보여 주지 않고 모른다고 둔다.
 */
export function dashboardFromRequests(scope: DashboardScope, page: Page<RequestSummary>): Dashboard {
  if (page.nextCursor) return unknownDashboard(scope)
  const statusCounts: Partial<Record<RequestStatus, number>> = {}
  for (const { status } of page.items) statusCounts[status] = (statusCounts[status] ?? 0) + 1
  return { ...unknownDashboard(scope), requestCount: page.items.length, statusCounts }
}
