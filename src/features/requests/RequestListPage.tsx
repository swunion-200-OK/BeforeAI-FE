import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { requestsApi } from '../../api/endpoints'
import type { RequestStatus, RequestSummary, Risk } from '../../api/types'
import { RequestStatusBadge, RiskBadge } from '../../components/badges'
import { SegmentedTabs, TaskProgress } from '../../components/rich'
import { Button, EmptyState, ErrorState, PageHeader, Select, Sheet, Spinner } from '../../components/ui'
import { formatDateTime } from '../../lib/format'
import { REQUEST_STATUS_LABEL } from '../../lib/labels'
import { useIsExternal, useProjects } from '../../lib/queries'
import { STATUS_GROUPS, pathFor, type StatusGroup } from './requestPaths'

const LIVE: RequestStatus[] = ['ANALYZING', 'RUNNING', 'ROLLING_BACK']
const PAGE_SIZE = 50
const RISK_HIGHEST_FIRST: Risk[] = ['FORBIDDEN', 'HIGH', 'MEDIUM', 'LOW']

type GroupId = StatusGroup['id'] | 'all'

function groupOfStatus(status: RequestStatus): StatusGroup['id'] {
  return STATUS_GROUPS.find((group) => group.statuses.includes(status))?.id ?? 'done'
}

function RequestRow({
  request,
  projectName,
  external,
  showRequester,
}: {
  request: RequestSummary
  projectName: string
  external: boolean
  showRequester: boolean
}) {
  const navigate = useNavigate()
  const to = pathFor(request, external)
  const summary = request.taskSummary
  const risk = summary && RISK_HIGHEST_FIRST.find((item) => summary.risks[item] > 0)
  return (
    <tr data-clickable="true" onClick={() => navigate(to)}>
      <td className="w-px whitespace-nowrap">
        <RequestStatusBadge status={request.status} />
      </td>
      <td>
        <Link
          to={to}
          className="line-clamp-1 max-w-[46rem] font-medium hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {request.prompt}
        </Link>
      </td>
      <td className="whitespace-nowrap text-ink-2">{projectName}</td>
      <td className="whitespace-nowrap">{risk && <RiskBadge risk={risk} />}</td>
      <td className="whitespace-nowrap">{summary && <TaskProgress summary={summary} />}</td>
      {showRequester && <td className="whitespace-nowrap text-ink-2">{request.requester.name}</td>}
      <td className="whitespace-nowrap text-ink-2 tabular-nums">{formatDateTime(request.createdAt)}</td>
    </tr>
  )
}

export default function RequestListPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const external = useIsExternal()
  const projects = useProjects()

  const status = (params.get('status') ?? '') as RequestStatus | ''
  const groupParam = params.get('group') as StatusGroup['id'] | null
  const projectId = params.get('projectId') ?? ''
  // 대시보드에서 부서·전사 범위로 들어오면 내 요청으로 좁히지 않는다.
  const mine = params.get('scope') !== 'all'
  const group = STATUS_GROUPS.find((item) => item.id === groupParam)
  const activeTab: GroupId = status ? groupOfStatus(status) : (group?.id ?? 'all')

  const query = useInfiniteQuery({
    queryKey: ['requests', { mine, status, projectId }],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      requestsApi.list({
        mine: mine || undefined,
        status: status || undefined,
        projectId: projectId || undefined,
        cursor: pageParam,
        limit: PAGE_SIZE,
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: (state) =>
      state.state.data?.pages.some((page) => page.items.some((r) => LIVE.includes(r.status))) ? 3000 : false,
  })

  // TODO(spec): 상태별 건수를 주는 API가 없어 목록 최대치(100건)로 센다. 다음 쪽이 있으면 건수가 실제보다 적으므로 숫자를 쓰지 않는다.
  const counts = useQuery({
    queryKey: ['requests', 'counts', { mine, projectId }],
    queryFn: () => requestsApi.list({ mine: mine || undefined, projectId: projectId || undefined, limit: 100 }),
    refetchInterval: 5000,
  })
  const tabs = useMemo(() => {
    const all = counts.data && !counts.data.nextCursor ? counts.data.items : undefined
    return [
      { id: 'all' as GroupId, label: '전체', count: all?.length },
      ...STATUS_GROUPS.map((item) => ({
        id: item.id as GroupId,
        label: item.label,
        count: all?.filter((r) => item.statuses.includes(r.status)).length,
      })),
    ]
  }, [counts.data])

  const loaded = query.data?.pages.flatMap((page) => page.items) ?? []
  const items = group && !status ? loaded.filter((r) => group.statuses.includes(r.status)) : loaded
  const projectName = (id: string) => projects.data?.find((p) => p.id === id)?.name ?? id
  const filtered = Boolean(status || projectId || group)

  // TODO(spec): 묶음 탭은 여러 상태라 서버에서 거를 수 없어 받은 쪽을 화면에서 거른다.
  // 받은 쪽에 해당 요청이 적어도 다음 쪽에 있을 수 있으니, 한 화면이 찰 때까지 이어서 받는다.
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = query
  const needsMore = Boolean(group && !status && hasNextPage && items.length < PAGE_SIZE)
  useEffect(() => {
    if (needsMore && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage()
  }, [needsMore, isFetchingNextPage, isFetchNextPageError, fetchNextPage])

  // 라우터 상태는 전환(transition)으로 늦게 반영될 수 있어, 필터를 연달아 바꿔도 앞의 변경을 잃지 않도록 주소에서 직접 읽는다.
  const setFilter = (key: 'status' | 'projectId', value: string) => {
    const next = new URLSearchParams(window.location.search)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const setTab = (id: GroupId) => {
    const next = new URLSearchParams(window.location.search)
    next.delete('status')
    if (id === 'all') next.delete('group')
    else next.set('group', id)
    setParams(next, { replace: true })
  }

  return (
    <>
      <PageHeader title={mine ? '내 요청' : '요청 현황'} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedTabs label="진행 단계로 나눠 보기" items={tabs} value={activeTab} onChange={setTab} />
          {/* 대시보드의 ?status= 링크로 들어오면 탭보다 좁게 걸러지므로, 무엇으로 걸렀는지 알리고 풀 수 있게 한다 */}
          {status && (
            <button
              type="button"
              aria-label={`${REQUEST_STATUS_LABEL[status]} 필터 해제`}
              onClick={() => setFilter('status', '')}
              className="text-sm text-ink-2 hover:text-ink"
            >
              {REQUEST_STATUS_LABEL[status]}만 보는 중 ×
            </button>
          )}
        </div>
        <Select
          aria-label="프로젝트"
          value={projectId}
          onChange={(event) => setFilter('projectId', event.target.value)}
          className="!w-48 !text-ink-2"
        >
          <option value="">모든 프로젝트</option>
          {projects.data?.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </Select>
      </div>

      <Sheet flush className="overflow-hidden">
        {(query.isPending || (needsMore && items.length === 0 && !isFetchNextPageError)) && <Spinner />}
        {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
        {query.isSuccess && items.length === 0 && !hasNextPage && (
          <EmptyState
            title={filtered ? '조건에 맞는 요청이 없습니다' : '아직 요청이 없습니다'}
            action={
              filtered ? (
                <Button onClick={() => setParams(mine ? {} : { scope: 'all' }, { replace: true })}>필터 지우기</Button>
              ) : (
                <Button internalOnly onClick={() => navigate('/requests/new')}>
                  작업 요청
                </Button>
              )
            }
          />
        )}
        {items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="sheet-table">
              <thead>
                <tr>
                  <th>상태</th>
                  <th>요청</th>
                  <th>프로젝트</th>
                  <th>위험도</th>
                  <th>진행</th>
                  {!mine && <th>요청자</th>}
                  <th>시각</th>
                </tr>
              </thead>
              <tbody>
                {items.map((request) => (
                  <RequestRow
                    key={request.id}
                    request={request}
                    projectName={projectName(request.projectId)}
                    external={external}
                    showRequester={!mine}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Sheet>

      {query.hasNextPage && (
        <div className="mt-3">
          <Button loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
            더 보기
          </Button>
        </div>
      )}
    </>
  )
}
