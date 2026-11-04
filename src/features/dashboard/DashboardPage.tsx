import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { dashboardApi } from '../../api/endpoints'
import type { DashboardScope, RequestStatus, Role } from '../../api/types'
import { useMe } from '../../app/AuthProvider'
import { ErrorState, PageHeader, Spinner } from '../../components/ui'
import { useDepartmentNames, usePendingApprovals } from '../../lib/queries'
import { groupByRequest } from '../approvals/queueGroups'
import { DashboardDetails, RunningPanel, TodoPanel } from './DashboardPanels'
import { ATTENTION_STATUSES } from './statusGroups'

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

function Stat({ label, value, to, alert }: { label: string; value: number; to: string; alert?: boolean }) {
  return (
    <Link to={to} className="group">
      <span className="block text-sm text-ink-2">{label}</span>
      <span
        className={`block text-[2.25rem] leading-tight font-bold tracking-tight tabular-nums group-hover:text-seal ${
          alert ? 'text-high' : 'text-ink'
        }`}
      >
        {value}
        <span className="ml-1 text-base font-medium text-ink-3">건</span>
      </span>
    </Link>
  )
}

export default function DashboardPage() {
  const me = useMe()
  const departmentName = useDepartmentNames()
  const pending = usePendingApprovals()
  const scope = SCOPE_BY_ROLE[me.role]
  const query = useQuery({
    queryKey: ['dashboard', scope],
    queryFn: () => dashboardApi.get(scope),
    refetchInterval: 5000,
  })

  // 직원의 요청 목록은 원래 본인 요청뿐이라 범위를 넓히지 않는다.
  const wholeScope = me.role !== 'EMPLOYEE'
  const requestsTo = wholeScope ? '/requests?scope=all' : '/requests'
  const statusTo = (status: RequestStatus) =>
    wholeScope ? `/requests?status=${status}&scope=all` : `/requests?status=${status}`

  const data = query.data
  const count = (status: RequestStatus) => data?.statusCounts[status] ?? 0
  const attention = ATTENTION_STATUSES.filter((status) => count(status) > 0)
  const attentionTotal = attention.reduce((sum, status) => sum + count(status), 0)
  const myPending = groupByRequest(pending.data ?? []).length

  const scopeName = { COMPANY: '회사 전체', DEPARTMENT: departmentName(me.departmentId), ME: '내 요청' }[scope]
  const headline =
    myPending > 0
      ? `승인할 요청 ${myPending}건이 있습니다.`
      : attentionTotal > 0
        ? `확인이 필요한 요청 ${attentionTotal}건이 있습니다.`
        : `${scopeName} 현황입니다.`

  return (
    <>
      <PageHeader title={TITLE[scope]} description={<span className="text-base">{headline}</span>} />
      {query.isPending && <Spinner />}
      {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
      {data && (
        <div className="flex flex-col gap-6">
          <div className="flex gap-16">
            <Stat label="내 승인 대기" value={myPending} to="/approvals" />
            <Stat label="실행 중" value={count('RUNNING')} to={statusTo('RUNNING')} />
            <Stat
              label="확인 필요"
              value={attentionTotal}
              alert={attentionTotal > 0}
              // 목록 필터는 상태 하나만 받으므로 가장 급한 상태로 보낸다.
              to={attention[0] ? statusTo(attention[0]) : requestsTo}
            />
            <Stat label="요청" value={data.requestCount} to={requestsTo} />
          </div>

          <div className="flex items-start gap-3">
            <TodoPanel
              className="min-w-0 flex-[1.6]"
              // "확인 필요"가 남아 있는데 "처리할 일이 없다"고 하면 위 숫자와 어긋난다.
              emptyText={attentionTotal > 0 ? '지금 승인할 작업이 없습니다' : '지금 처리할 일이 없습니다'}
            />
            <RunningPanel className="min-w-0 flex-1" canKillAll={me.role === 'ADMIN'} listTo={statusTo('RUNNING')} />
          </div>

          <DashboardDetails data={data} statusTo={statusTo} />
        </div>
      )}
    </>
  )
}
