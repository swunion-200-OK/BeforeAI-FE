import { useQuery } from '@tanstack/react-query'
import { CircleCheck, ClipboardCheck, Hourglass, ListChecks, LoaderCircle, TriangleAlert } from 'lucide-react'
import { dashboardApi } from '../../api/endpoints'
import type { DashboardScope, RequestStatus, Role } from '../../api/types'
import { useMe } from '../../app/AuthProvider'
import { StatCard } from '../../components/rich'
import { ErrorState, PageHeader, Spinner } from '../../components/ui'
import { formatElapsed } from '../../lib/format'
import { REQUEST_STATUS_LABEL } from '../../lib/labels'
import { useDepartmentNames, usePendingApprovals } from '../../lib/queries'
import {
  ActivityPanel,
  DepartmentPanel,
  RiskPanel,
  RunningPanel,
  StatusPanel,
  TodoPanel,
} from './DashboardPanels'
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

function Count({ value }: { value: number }) {
  return (
    <>
      {value}
      <span className="ml-0.5 text-sm font-medium text-ink-3">건</span>
    </>
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

  const scopeName = { COMPANY: '회사 전체', DEPARTMENT: departmentName(me.departmentId), ME: '내가 요청한 작업' }[scope]
  const data = query.data
  const counts = data?.statusCounts ?? {}
  const count = (status: RequestStatus) => counts[status] ?? 0

  const attention = ATTENTION_STATUSES.filter((status) => count(status) > 0)
  const attentionTotal = attention.reduce((sum, status) => sum + count(status), 0)
  const myPending = pending.data ?? []
  const internalNeeded = myPending.filter((item) => item.blockedReason).length

  const headline = () => {
    if (!data || !pending.data) return `${scopeName}의 요청과 승인 현황입니다.`
    if (myPending.length === 0 && attentionTotal === 0) return `${me.name}님, 지금 처리할 일이 없습니다.`
    const parts = [
      myPending.length > 0 ? `승인할 작업 ${myPending.length}건` : null,
      attentionTotal > 0 ? `확인이 필요한 요청 ${attentionTotal}건` : null,
    ].filter(Boolean)
    return `${me.name}님, ${parts.join('과 ')}이 있습니다.`
  }

  return (
    <>
      <PageHeader title={TITLE[scope]} description={headline()} />
      {query.isPending && <Spinner />}
      {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
      {data && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-3 xl:grid-cols-6">
            <StatCard label="요청" value={<Count value={data.requestCount} />} hint={scopeName} icon={ListChecks} to={requestsTo} />
            <StatCard
              label="승인 대기 중인 요청"
              value={<Count value={data.pendingApprovalCount} />}
              hint="승인 서명을 기다립니다"
              icon={Hourglass}
              tone="amber"
              to={statusTo('PENDING_APPROVAL')}
            />
            <StatCard
              label="내 승인 대기"
              value={<Count value={myPending.length} />}
              hint={
                internalNeeded > 0
                  ? `내부망 승인 필요 ${internalNeeded}건`
                  : myPending[0]
                    ? `가장 오래 ${formatElapsed(myPending[0].requestedAt)} 대기`
                    : '지금 승인할 작업 없음'
              }
              icon={ClipboardCheck}
              to="/approvals"
            />
            <StatCard
              label="실행 중"
              value={<Count value={count('RUNNING')} />}
              hint={count('RUNNING') > 0 ? '실시간 로그 확인' : '실행 중인 작업 없음'}
              icon={LoaderCircle}
              tone="live"
              to={statusTo('RUNNING')}
            />
            <StatCard
              label="확인 필요"
              value={<Count value={attentionTotal} />}
              hint={
                attention[0]
                  ? attentionTotal > count(attention[0])
                    ? `${REQUEST_STATUS_LABEL[attention[0]]} ${count(attention[0])}건 외 ${attentionTotal - count(attention[0])}건`
                    : `${REQUEST_STATUS_LABEL[attention[0]]} ${count(attention[0])}건`
                  : '문제없이 진행 중입니다'
              }
              icon={TriangleAlert}
              tone={attentionTotal > 0 ? 'red' : 'neutral'}
              alert={attentionTotal > 0}
              // 목록 필터는 상태 하나만 받으므로 가장 급한 상태로 보낸다.
              to={attention[0] ? statusTo(attention[0]) : requestsTo}
            />
            <StatCard
              label="완료"
              value={<Count value={count('COMPLETED')} />}
              hint={data.requestCount > 0 ? `전체의 ${Math.round((count('COMPLETED') / data.requestCount) * 100)}%` : '아직 요청 없음'}
              icon={CircleCheck}
              tone="green"
              to={statusTo('COMPLETED')}
            />
          </div>

          <div className="grid items-stretch gap-3 lg:grid-cols-2 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1.25fr)_minmax(0,1fr)]">
            <TodoPanel />
            <RunningPanel canKillAll={me.role === 'ADMIN'} listTo={statusTo('RUNNING')} />
            <RiskPanel distribution={data.riskDistribution} />
          </div>

          <div className="grid items-stretch gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="flex min-w-0 flex-col gap-3">
              <StatusPanel counts={data.statusCounts} statusTo={statusTo} />
              {data.byDepartment && <DepartmentPanel departments={data.byDepartment} />}
            </div>
            <ActivityPanel />
          </div>
        </div>
      )}
    </>
  )
}
