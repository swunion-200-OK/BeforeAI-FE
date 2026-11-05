import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import { dashboardApi, requestsApi } from '../../api/endpoints'
import type { DashboardScope, RequestStatus, Role } from '../../api/types'
import { useMe } from '../../app/AuthProvider'
import { ErrorState, PageHeader, Spinner } from '../../components/ui'
import { useDepartmentNames, usePendingApprovals } from '../../lib/queries'
import { groupByRequest } from '../approvals/queueGroups'
import { DashboardDetails, KillAllAction, RequestsPanel, TodoPanel } from './DashboardPanels'
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

type DashboardView = 'todo' | 'running' | 'attention' | 'all'

const VIEWS: DashboardView[] = ['todo', 'running', 'attention', 'all']

/** 숫자 칸. 누르면 페이지를 옮기지 않고 아래 목록만 그 내용으로 바꾼다. 0은 흐리게 둔다. */
function Stat({
  label,
  value,
  selected,
  alert,
  onSelect,
}: {
  label: string
  value: number
  selected: boolean
  alert?: boolean
  onSelect: () => void
}) {
  const number = value === 0 ? 'text-ink-3' : alert ? 'text-high' : 'text-ink'
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`-mb-px border-b-2 px-4 pt-3 pb-3.5 text-left transition-colors hover:bg-sheet-alt ${
        selected ? 'border-seal' : 'border-transparent'
      }`}
    >
      <span className={`block text-sm ${selected ? 'font-semibold text-ink' : 'text-ink-2'}`}>{label}</span>
      <span className={`mt-0.5 block text-[2.25rem] leading-tight font-semibold tracking-[-0.02em] tabular-nums ${number}`}>
        {value}
        <span className="ml-1 text-base font-normal tracking-normal text-ink-3">건</span>
      </span>
    </button>
  )
}

export default function DashboardPage() {
  const me = useMe()
  const [params, setParams] = useSearchParams()
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
  const scopeSuffix = wholeScope ? '&scope=all' : ''
  const requestsTo = wholeScope ? '/requests?scope=all' : '/requests'
  const statusTo = (status: RequestStatus) =>
    wholeScope ? `/requests?status=${status}&scope=all` : `/requests?status=${status}`

  const data = query.data
  const count = (status: RequestStatus) => data?.statusCounts[status] ?? 0
  const attention = ATTENTION_STATUSES.filter((status) => count(status) > 0)
  const attentionTotal = attention.reduce((sum, status) => sum + count(status), 0)
  const myPending = groupByRequest(pending.data ?? []).length

  // 칸을 누르지 않았으면 지금 가장 먼저 볼 내용을 고른다. 상세에 다녀와도 그대로이도록 선택은 주소에 둔다.
  const picked = params.get('view') as DashboardView | null
  const firstView: DashboardView =
    pending.isPending || myPending > 0 ? 'todo' : attentionTotal > 0 ? 'attention' : count('RUNNING') > 0 ? 'running' : 'todo'
  const view = picked && VIEWS.includes(picked) ? picked : firstView
  const select = (next: DashboardView) => setParams({ view: next }, { replace: true })

  // TODO(spec): 여러 상태를 한 번에 거르는 목록 API가 없어 최대치(100건)를 받아 화면에서 거른다.
  const requests = useQuery({
    queryKey: ['dashboard', 'requests', scope],
    queryFn: async () => (await requestsApi.list({ mine: wholeScope ? undefined : true, limit: 100 })).items,
    enabled: view !== 'todo',
    refetchInterval: 3000,
  })

  const scopeName = { COMPANY: '회사 전체', DEPARTMENT: departmentName(me.departmentId), ME: '내 요청' }[scope]
  const headline =
    myPending > 0
      ? `승인할 요청 ${myPending}건이 있습니다.`
      : attentionTotal > 0
        ? `확인이 필요한 요청 ${attentionTotal}건이 있습니다.`
        : `${scopeName} 현황입니다.`

  return (
    <>
      <PageHeader
        title={TITLE[scope]}
        description={<span className="text-lg font-medium text-ink">{headline}</span>}
        actions={me.role === 'ADMIN' ? <KillAllAction visible={count('RUNNING') > 0} /> : undefined}
      />
      {query.isPending && <Spinner />}
      {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
      {data && (
        <div className="flex flex-col gap-6">
          <div role="group" aria-label="아래 목록 고르기" className="grid grid-cols-4 border-b border-rule">
            <Stat label="내 승인 대기" value={myPending} selected={view === 'todo'} onSelect={() => select('todo')} />
            <Stat label="실행 중" value={count('RUNNING')} selected={view === 'running'} onSelect={() => select('running')} />
            <Stat
              label="확인 필요"
              value={attentionTotal}
              alert
              selected={view === 'attention'}
              onSelect={() => select('attention')}
            />
            <Stat label="요청" value={data.requestCount} selected={view === 'all'} onSelect={() => select('all')} />
          </div>

          {view === 'todo' && (
            // "확인 필요"가 남아 있는데 "처리할 일이 없다"고 하면 위 숫자와 어긋난다.
            <TodoPanel emptyText={attentionTotal > 0 ? '지금 승인할 작업이 없습니다' : '지금 처리할 일이 없습니다'} />
          )}
          {view === 'running' && (
            <RequestsPanel
              title="실행 중"
              query={requests}
              statuses={['RUNNING']}
              emptyText="지금 실행 중인 요청이 없습니다"
              listTo={statusTo('RUNNING')}
            />
          )}
          {view === 'attention' && (
            <RequestsPanel
              title="확인 필요"
              query={requests}
              statuses={ATTENTION_STATUSES}
              emptyText="지금 확인할 요청이 없습니다"
              listTo={`/requests?group=attention${scopeSuffix}`}
            />
          )}
          {view === 'all' && (
            <RequestsPanel title="요청" query={requests} emptyText="아직 요청이 없습니다" listTo={requestsTo} />
          )}

          <DashboardDetails data={data} statusTo={statusTo} />
        </div>
      )}
    </>
  )
}
