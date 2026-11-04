import { useInfiniteQuery } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { requestsApi } from '../../api/endpoints'
import type { RequestStatus, RequestSummary } from '../../api/types'
import { RequestStatusBadge } from '../../components/badges'
import { Button, EmptyState, ErrorState, Field, PageHeader, Select, Sheet, Spinner } from '../../components/ui'
import { formatDateTime } from '../../lib/format'
import { REQUEST_STATUSES, REQUEST_STATUS_LABEL, SOURCE_LABEL } from '../../lib/labels'
import { useIsExternal, useProjects } from '../../lib/queries'

const LIVE: RequestStatus[] = ['ANALYZING', 'RUNNING', 'ROLLING_BACK']
const COMPOSE: RequestStatus[] = ['ANALYZING', 'REVIEWING', 'ANALYSIS_FAILED']

/** 제출 전 요청은 Plan 검토 화면으로 간다. 그 화면은 내부망 전용이라 외부망은 요청 상세로 보낸다. */
function pathFor(request: RequestSummary, external: boolean) {
  return COMPOSE.includes(request.status) && !external ? `/requests/new/${request.id}` : `/requests/${request.id}`
}

export default function RequestListPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const external = useIsExternal()
  const projects = useProjects()

  const status = (params.get('status') ?? '') as RequestStatus | ''
  const projectId = params.get('projectId') ?? ''
  // 대시보드에서 부서·전사 범위로 들어오면 내 요청으로 좁히지 않는다.
  const mine = params.get('scope') !== 'all'

  const query = useInfiniteQuery({
    queryKey: ['requests', { mine, status, projectId }],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      requestsApi.list({
        mine: mine || undefined,
        status: status || undefined,
        projectId: projectId || undefined,
        cursor: pageParam,
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: (state) =>
      state.state.data?.pages.some((page) => page.items.some((r) => LIVE.includes(r.status))) ? 3000 : false,
  })

  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  const projectName = (id: string) => projects.data?.find((p) => p.id === id)?.name ?? id
  const filtered = Boolean(status || projectId)

  const setFilter = (key: 'status' | 'projectId', value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
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

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-40">
          <Field label="상태">
            {(id) => (
              <Select id={id} value={status} onChange={(event) => setFilter('status', event.target.value)}>
                <option value="">전체</option>
                {REQUEST_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {REQUEST_STATUS_LABEL[value]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="w-48">
          <Field label="프로젝트">
            {(id) => (
              <Select id={id} value={projectId} onChange={(event) => setFilter('projectId', event.target.value)}>
                <option value="">전체</option>
                {projects.data?.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </div>

      <Sheet flush>
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
            {filtered ? '상태나 프로젝트 필터를 바꿔 보세요.' : '프롬프트를 입력하면 AI가 작업 계획을 만들어 줍니다.'}
          </EmptyState>
        )}
        {items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="sheet-table">
              <thead>
                <tr>
                  <th>상태</th>
                  <th>요청 내용</th>
                  <th>프로젝트</th>
                  {!mine && <th>요청자</th>}
                  <th>요청 시각</th>
                </tr>
              </thead>
              <tbody>
                {items.map((request) => (
                  <tr key={request.id} data-clickable="true" onClick={() => navigate(pathFor(request, external))}>
                    <td>
                      <RequestStatusBadge status={request.status} />
                    </td>
                    <td className="max-w-md">
                      <Link
                        to={pathFor(request, external)}
                        className="line-clamp-2 font-medium hover:underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {request.prompt}
                      </Link>
                      {request.source !== 'PROMPT' && (
                        <span className="text-xs text-ink-3">{SOURCE_LABEL[request.source]}에서 만듦</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap">{projectName(request.projectId)}</td>
                    {!mine && <td className="whitespace-nowrap">{request.requester.name}</td>}
                    <td className="whitespace-nowrap text-ink-2">{formatDateTime(request.createdAt)}</td>
                  </tr>
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
