import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { dashboardApi } from '../../api/endpoints'
import type { DashboardScope, RequestStatus, Role } from '../../api/types'
import { useMe } from '../../app/AuthProvider'
import { Button, EmptyState, ErrorState, PageHeader, Sheet, Spinner } from '../../components/ui'
import { useDepartmentNames } from '../../lib/queries'
import { DepartmentComparison, RiskDistribution, StatusCounts, SummaryRow } from './DashboardCharts'

const SCOPE_BY_ROLE: Record<Role, DashboardScope> = {
  ADMIN: 'COMPANY',
  DEPT_MANAGER: 'DEPARTMENT',
  EMPLOYEE: 'ME',
}

const TITLE: Record<DashboardScope, string> = {
  COMPANY: '전사 대시보드',
  DEPARTMENT: '부서 대시보드',
  ME: '내 대시보드',
}

export default function DashboardPage() {
  const me = useMe()
  const navigate = useNavigate()
  const departmentName = useDepartmentNames()
  const scope = SCOPE_BY_ROLE[me.role]
  const query = useQuery({
    queryKey: ['dashboard', scope],
    queryFn: () => dashboardApi.get(scope),
  })

  const description = {
    COMPANY: '회사 전체의 요청과 승인 현황입니다.',
    DEPARTMENT: `${departmentName(me.departmentId)}의 요청과 승인 현황입니다.`,
    ME: '내가 요청한 작업의 현황입니다.',
  }[scope]

  // 직원의 요청 목록은 원래 본인 요청뿐이라 범위를 넓히지 않는다.
  const wholeScope = me.role !== 'EMPLOYEE'
  const requestsTo = wholeScope ? '/requests?scope=all' : '/requests'
  const statusTo = (status: RequestStatus) =>
    wholeScope ? `/requests?status=${status}&scope=all` : `/requests?status=${status}`

  return (
    <>
      <PageHeader title={TITLE[scope]} description={description} />
      {query.isPending && <Spinner />}
      {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
      {query.data &&
        (query.data.requestCount === 0 ? (
          <Sheet>
            <EmptyState
              title="아직 요청이 없습니다"
              action={
                <Button variant="primary" internalOnly onClick={() => navigate('/requests/new')}>
                  작업 요청하기
                </Button>
              }
            >
              작업을 요청하면 상태와 위험도가 이곳에 모입니다.
            </EmptyState>
          </Sheet>
        ) : (
          <div className="flex flex-col gap-4">
            <SummaryRow
              requestCount={query.data.requestCount}
              pendingApprovalCount={query.data.pendingApprovalCount}
              requestsTo={requestsTo}
            />
            <div className="grid items-start gap-4 lg:grid-cols-2">
              <StatusCounts counts={query.data.statusCounts} statusTo={statusTo} />
              <RiskDistribution distribution={query.data.riskDistribution} />
            </div>
            {query.data.byDepartment && <DepartmentComparison departments={query.data.byDepartment} />}
          </div>
        ))}
    </>
  )
}
