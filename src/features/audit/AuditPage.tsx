import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Download, ListFilter } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { auditApi } from '../../api/endpoints'
import type { AuditLog, Role } from '../../api/types'
import { useMe } from '../../app/AuthProvider'
import { NetworkBadge } from '../../components/badges'
import { Button, EmptyState, ErrorState, PageHeader, Sheet, Spinner } from '../../components/ui'
import { formatDateTime } from '../../lib/format'
import { AUDIT_ACTION_LABEL } from '../../lib/labels'
import { AuditActionLabel } from './AuditActionLabel'
import { AuditDetailDrawer } from './AuditDetailDrawer'
import { AuditExportModal } from './AuditExportModal'
import { AuditFilters } from './AuditFilters'
import {
  QUICK_FILTERS,
  countFilters,
  isQuickFilterActive,
  toAuditQuery,
  toggleQuickFilter,
  type FilterKey,
} from './auditFilterParams'

const PAGE_SIZE = 30

const SCOPE_DESCRIPTION: Record<Role, string> = {
  ADMIN: '회사 전체의 기록을 봅니다.',
  DEPT_MANAGER: '소속 부서의 기록만 보입니다.',
  EMPLOYEE: '본인 요청에 대한 기록만 보입니다.',
}

function TargetCell({ log }: { log: AuditLog }) {
  const { requestId, taskIds, label } = log.target
  return (
    <div className="flex flex-wrap items-center gap-x-2">
      {requestId && (
        <Link
          to={`/requests/${requestId}`}
          onClick={(event) => event.stopPropagation()}
          className="font-mono text-[0.875rem] text-seal hover:underline"
        >
          {requestId}
        </Link>
      )}
      {taskIds && taskIds.length > 0 && <span className="font-mono text-xs text-ink-3">{taskIds.join(', ')}</span>}
      {label && <span className="text-sm text-ink-2">{label}</span>}
      {!requestId && !label && <span className="text-ink-3">-</span>}
    </div>
  )
}

export default function AuditPage() {
  const me = useMe()
  const [params, setParams] = useSearchParams()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const filters = useMemo(() => toAuditQuery(params), [params])

  const logs = useInfiniteQuery({
    queryKey: ['audit-logs', filters],
    queryFn: ({ pageParam }) => auditApi.list({ ...filters, cursor: pageParam, limit: PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })

  // 필터를 걸어도 사용자 목록이 줄어들지 않도록 필터 없는 기록에서도 뽑는다.
  const recent = useQuery({
    queryKey: ['audit-logs', 'recent-actors'],
    queryFn: () => auditApi.list({ limit: 100 }),
  })

  const items = useMemo(() => logs.data?.pages.flatMap((page) => page.items) ?? [], [logs.data])

  const actors = useMemo(() => {
    const seen = new Map<string, string>()
    for (const log of [...(recent.data?.items ?? []), ...items]) seen.set(log.actor.id, log.actor.name)
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  }, [recent.data, items])

  const changeFilter = (key: FilterKey, value: string) => {
    if ((params.get(key) ?? '') === value) return
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const clearFilters = () => setParams(new URLSearchParams(), { replace: true })

  const activeFilters = countFilters(params)

  return (
    <>
      <PageHeader
        title="감사 로그"
        description={SCOPE_DESCRIPTION[me.role]}
        actions={
          <Button internalOnly onClick={() => setExportOpen(true)}>
            <Download size={15} aria-hidden />
            내보내기
          </Button>
        }
      />

      <Sheet flush>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          {QUICK_FILTERS.map((filter) => {
            const active = isQuickFilterActive(filter.id, params)
            return (
              <button
                key={filter.id}
                type="button"
                aria-pressed={active}
                onClick={() => setParams(toggleQuickFilter(filter.id, params), { replace: true })}
                className={`h-8 rounded-full border px-3 text-sm font-medium whitespace-nowrap ${
                  active
                    ? 'border-seal bg-seal-soft text-seal-dark'
                    : 'border-rule-strong bg-sheet text-ink-2 hover:border-seal/60 hover:text-ink'
                }`}
              >
                {filter.label}
              </button>
            )
          })}
          <Button size="sm" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}>
            <ListFilter size={14} aria-hidden />
            필터
          </Button>
          {activeFilters > 0 && (
            <>
              <span className="ml-2 text-sm text-ink-2">필터 {activeFilters}개 적용 중</span>
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                해제
              </Button>
            </>
          )}
          {logs.isSuccess && (
            <span className="ml-auto text-sm text-ink-3 tabular-nums">
              {/* 더 불러올 기록이 남아 있으면 지금까지 받은 건수라는 뜻으로 +를 붙인다. */}
              {items.length}
              {logs.hasNextPage ? '+' : ''}건
            </span>
          )}
        </div>
        {filtersOpen && <AuditFilters params={params} actors={actors} onChange={changeFilter} />}

        {logs.isPending && <Spinner />}
        {logs.isError && <ErrorState error={logs.error} onRetry={() => logs.refetch()} />}
        {logs.isSuccess && items.length === 0 && (
          <EmptyState title={activeFilters > 0 ? '조건에 맞는 기록이 없습니다' : '아직 기록이 없습니다'} />
        )}
        {items.length > 0 && (
          // 표가 카드 폭에 맞춰 줄어들고, 그래도 안 들어가는 좁은 화면에서만 카드 안에서 옆으로 움직인다.
          // 스크롤 칸을 항상 두면 머리글이 본문 스크롤을 따라오지 못한다.
          <div className="max-[1100px]:overflow-x-auto">
            <table className="sheet-table [&_td]:py-3 [&_th]:sticky [&_th]:top-0 [&_th]:z-10">
              <thead>
                <tr>
                  <th scope="col">시각</th>
                  <th scope="col">사용자</th>
                  <th scope="col">액션</th>
                  <th scope="col">대상</th>
                  <th scope="col">접속 환경</th>
                </tr>
              </thead>
              <tbody>
                {items.map((log) => (
                  <tr
                    key={log.id}
                    data-clickable="true"
                    tabIndex={0}
                    aria-label={`${log.actor.name} ${AUDIT_ACTION_LABEL[log.action] ?? log.action} 상세 열기`}
                    onClick={() => setSelectedId(log.id)}
                    onKeyDown={(event) => {
                      if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                        event.preventDefault()
                        setSelectedId(log.id)
                      }
                    }}
                  >
                    <td className="whitespace-nowrap text-ink-2 tabular-nums">{formatDateTime(log.at)}</td>
                    <td className="whitespace-nowrap text-ink">{log.actor.name}</td>
                    <td>
                      <AuditActionLabel action={log.action} />
                    </td>
                    <td>
                      <TargetCell log={log} />
                    </td>
                    <td>
                      <span className="inline-flex flex-wrap items-center gap-x-2.5">
                        {/* 대부분이 내부망이라 외부망 기록만 도드라지게 한다 */}
                        {log.network === 'EXTERNAL' ? (
                          <NetworkBadge network={log.network} />
                        ) : (
                          <span className="text-ink-3">내부망</span>
                        )}
                        <span className="font-mono text-xs text-ink-3">{log.ip}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {logs.hasNextPage && (
          <div className="flex justify-center border-t border-rule p-3">
            <Button loading={logs.isFetchingNextPage} onClick={() => logs.fetchNextPage()}>
              더 보기
            </Button>
          </div>
        )}
      </Sheet>

      <AuditDetailDrawer logId={selectedId} onClose={() => setSelectedId(null)} />
      <AuditExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        filters={filters}
        actors={actors}
      />
    </>
  )
}
