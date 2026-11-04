import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { requestsApi } from '../../api/endpoints'
import type { RequestStatus, RequestSummary } from '../../api/types'
import { RequestStatusBadge } from '../../components/badges'
import { ProjectTag, RiskSummary, SegmentedTabs, TaskProgress, UserChip } from '../../components/rich'
import { Button, EmptyState, ErrorState, PageHeader, Select, Sheet, Spinner } from '../../components/ui'
import { formatDateTime, formatElapsed } from '../../lib/format'
import { REQUEST_STATUSES, REQUEST_STATUS_LABEL, SOURCE_LABEL } from '../../lib/labels'
import { useDepartmentNames, useIsExternal, useProjects } from '../../lib/queries'
import { STATUS_GROUPS, pathFor, type StatusGroup } from './requestPaths'

const LIVE: RequestStatus[] = ['ANALYZING', 'RUNNING', 'ROLLING_BACK']
const PAGE_SIZE = 50

type GroupId = StatusGroup['id'] | 'all'

function groupOfStatus(status: RequestStatus): StatusGroup['id'] {
  return STATUS_GROUPS.find((group) => group.statuses.includes(status))?.id ?? 'done'
}

function RequestRow({ request, projectName, external }: { request: RequestSummary; projectName: string; external: boolean }) {
  const navigate = useNavigate()
  const departmentName = useDepartmentNames()
  const to = pathFor(request, external)
  return (
    <tr data-clickable="true" onClick={() => navigate(to)}>
      <td className="w-px whitespace-nowrap">
        <RequestStatusBadge status={request.status} />
      </td>
      <td>
        <Link
          to={to}
          className="line-clamp-1 max-w-[52rem] font-semibold hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {request.prompt}
        </Link>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-3">
          <ProjectTag name={projectName} />
          {request.source !== 'PROMPT' && (
            <span className="text-xs text-ink-3">{SOURCE_LABEL[request.source]}에서 만듦</span>
          )}
        </span>
      </td>
      <td className="whitespace-nowrap">
        {request.taskSummary ? <RiskSummary risks={request.taskSummary.risks} /> : <span className="text-xs text-ink-3">아직 작업 없음</span>}
      </td>
      <td className="whitespace-nowrap">{request.taskSummary && <TaskProgress summary={request.taskSummary} />}</td>
      <td className="whitespace-nowrap">
        <UserChip name={request.requester.name} sub={departmentName(request.requester.departmentId)} />
      </td>
      <td className="whitespace-nowrap">
        <span className="block text-[0.8125rem] text-ink-2 tabular-nums">{formatDateTime(request.createdAt)}</span>
        <span className="block text-xs text-ink-3">{formatElapsed(request.createdAt)} 전</span>
      </td>
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

  // TODO(spec): 상태별 건수를 주는 API가 없어 목록 최대치(100건)로 센다. 그보다 많으면 건수가 실제보다 적게 보인다.
  const counts = useQuery({
    queryKey: ['requests', 'counts', { mine, projectId }],
    queryFn: async () =>
      (await requestsApi.list({ mine: mine || undefined, projectId: projectId || undefined, limit: 100 })).items,
    refetchInterval: 5000,
  })
  const tabs = useMemo(() => {
    const all = counts.data ?? []
    return [
      { id: 'all' as GroupId, label: '전체', count: counts.data ? all.length : undefined },
      ...STATUS_GROUPS.map((item) => ({
        id: item.id as GroupId,
        label: item.label,
        count: counts.data ? all.filter((r) => item.statuses.includes(r.status)).length : undefined,
      })),
    ]
  }, [counts.data])

  const loaded = query.data?.pages.flatMap((page) => page.items) ?? []
  const items = group && !status ? loaded.filter((r) => group.statuses.includes(r.status)) : loaded
  const projectName = (id: string) => projects.data?.find((p) => p.id === id)?.name ?? id
  const filtered = Boolean(status || projectId || group)

  // 라우터 상태는 전환(transition)으로 늦게 반영될 수 있어, 필터를 연달아 바꿔도 앞의 변경을 잃지 않도록 주소에서 직접 읽는다.
  const setFilter = (key: 'status' | 'projectId', value: string) => {
    const next = new URLSearchParams(window.location.search)
    if (value) next.set(key, value)
    else next.delete(key)
    // 상태를 하나 고르면 묶음 탭 조건은 필요 없다.
    if (key === 'status') next.delete('group')
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
      <PageHeader
        title={mine ? '내 요청' : '요청 현황'}
        description={mine ? '내가 요청한 작업의 진행 상태입니다.' : '조회 권한이 있는 범위의 요청입니다.'}
        actions={
          <Button variant="primary" internalOnly onClick={() => navigate('/requests/new')}>
            작업 요청
          </Button>
        }
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs label="진행 단계로 나눠 보기" items={tabs} value={activeTab} onChange={setTab} />
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-[0.8125rem] text-ink-2">
            상태
            <Select value={status} onChange={(event) => setFilter('status', event.target.value)} className="!w-32">
              <option value="">전체</option>
              {REQUEST_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {REQUEST_STATUS_LABEL[value]}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-center gap-1.5 text-[0.8125rem] text-ink-2">
            프로젝트
            <Select value={projectId} onChange={(event) => setFilter('projectId', event.target.value)} className="!w-44">
              <option value="">전체</option>
              {projects.data?.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </label>
        </div>
      </div>

      <Sheet flush className="overflow-hidden">
        {query.isPending && <Spinner />}
        {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
        {query.isSuccess && items.length === 0 && (
          <EmptyState
            title={filtered ? '조건에 맞는 요청이 없습니다' : '아직 요청이 없습니다'}
            action={
              filtered ? (
                <Button onClick={() => setParams(mine ? {} : { scope: 'all' }, { replace: true })}>필터 지우기</Button>
              ) : (
                <Button variant="primary" internalOnly onClick={() => navigate('/requests/new')}>
                  작업 요청
                </Button>
              )
            }
          >
            {filtered ? '탭이나 상태, 프로젝트 필터를 바꿔 보세요.' : '프롬프트를 입력하면 AI가 작업 계획을 만들어 줍니다.'}
          </EmptyState>
        )}
        {items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="sheet-table [&_td]:py-1.5">
              <thead>
                <tr>
                  <th>상태</th>
                  <th>요청 내용</th>
                  <th>위험도</th>
                  <th>진행</th>
                  <th>요청자</th>
                  <th>요청 시각</th>
                </tr>
              </thead>
              <tbody>
                {items.map((request) => (
                  <RequestRow
                    key={request.id}
                    request={request}
                    projectName={projectName(request.projectId)}
                    external={external}
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
