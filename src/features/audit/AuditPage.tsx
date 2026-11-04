import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  CalendarDays,
  ChevronDown,
  Eye,
  FileClock,
  Globe,
  ListFilter,
  ShieldAlert,
  Stamp,
  type LucideIcon,
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { auditApi } from '../../api/endpoints'
import type { AuditLog, Role } from '../../api/types'
import { useMe } from '../../app/AuthProvider'
import { NetworkBadge } from '../../components/badges'
import { Button, EmptyState, ErrorState, Mono, PageHeader, Sheet, Spinner } from '../../components/ui'
import { formatDateTime } from '../../lib/format'
import { AUDIT_ACTION_LABEL } from '../../lib/labels'
import { ActorChip } from './ActorChip'
import { AuditActionLabel } from './AuditActionLabel'
import { AuditDetailDrawer } from './AuditDetailDrawer'
import { AuditFilters } from './AuditFilters'
import {
  QUICK_FILTERS,
  countFilters,
  hasFilters,
  isDangerAction,
  isQuickFilterActive,
  toAuditQuery,
  toggleQuickFilter,
  type FilterKey,
  type QuickFilterId,
} from './auditFilters'

const PAGE_SIZE = 30

const SCOPE_TEXT: Record<Role, string> = {
  ADMIN: '회사 전체',
  DEPT_MANAGER: '소속 부서',
  EMPLOYEE: '본인 요청',
}

const SCOPE_DESCRIPTION: Record<Role, string> = {
  ADMIN: '회사 전체의 기록을 봅니다.',
  DEPT_MANAGER: '소속 부서의 기록만 보입니다.',
  EMPLOYEE: '본인 요청에 대한 기록만 보입니다.',
}

const QUICK_ICON: Record<QuickFilterId, LucideIcon> = {
  'external-approval': Stamp,
  'verification-failed': ShieldAlert,
  today: CalendarDays,
}

function TargetCell({ log }: { log: AuditLog }) {
  const { requestId, taskIds, label } = log.target
  return (
    <div className="flex flex-wrap items-center gap-x-2">
      {requestId && (
        <Link
          to={`/requests/${requestId}`}
          onClick={(event) => event.stopPropagation()}
          className="font-mono text-[0.8125rem] text-seal hover:underline"
        >
          {requestId}
        </Link>
      )}
      {taskIds && taskIds.length > 0 && <span className="font-mono text-xs text-ink-3">{taskIds.join(', ')}</span>}
      {label && <span className="text-[0.8125rem] text-ink-2">{label}</span>}
      {!requestId && !label && <span className="text-ink-3">-</span>}
    </div>
  )
}

function SummaryCell({
  icon: Icon,
  label,
  children,
  tone = 'text-ink-2',
}: {
  icon: LucideIcon
  label: string
  children: ReactNode
  tone?: string
}) {
  return (
    <div className="flex items-center gap-2 px-4">
      <Icon size={16} className={tone} aria-hidden />
      <span className="text-[0.8125rem] whitespace-nowrap text-ink-2">{label}</span>
      <span className={`text-[0.9375rem] font-semibold whitespace-nowrap tabular-nums ${tone === 'text-ink-2' ? 'text-ink' : tone}`}>
        {children}
      </span>
    </div>
  )
}

export default function AuditPage() {
  const me = useMe()
  const [params, setParams] = useSearchParams()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(true)
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

  // 더 불러올 기록이 남아 있으면 지금까지 받은 건수라는 뜻으로 +를 붙인다.
  const more = logs.hasNextPage ? '+' : ''
  const externalCount = items.filter((log) => log.network === 'EXTERNAL').length
  const failedCount = items.filter((log) => log.action === 'VERIFICATION_FAILED').length
  const activeFilters = countFilters(params)

  return (
    <>
      <PageHeader
        title="감사 로그"
        description={`모든 요청, 승인, 실행 기록을 접속 환경과 함께 남깁니다. ${SCOPE_DESCRIPTION[me.role]}`}
      />

      <Sheet flush className="mb-3">
        <div className="flex flex-wrap items-center justify-between gap-y-2 py-2.5">
          <div className="flex flex-wrap items-center divide-x divide-rule">
            <SummaryCell icon={Eye} label="조회 범위">
              {SCOPE_TEXT[me.role]}
            </SummaryCell>
            <SummaryCell icon={FileClock} label="기록">
              {items.length}
              {more}건
            </SummaryCell>
            <SummaryCell icon={Globe} label="외부망" tone={externalCount > 0 ? 'text-external' : 'text-ink-2'}>
              {externalCount}
              {more}건
            </SummaryCell>
            <SummaryCell icon={ShieldAlert} label="검증 실패" tone={failedCount > 0 ? 'text-high' : 'text-ink-2'}>
              {failedCount}
              {more}건
            </SummaryCell>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 px-4">
            {QUICK_FILTERS.map((filter) => {
              const active = isQuickFilterActive(filter.id, params)
              const Icon = QUICK_ICON[filter.id]
              return (
                <button
                  key={filter.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setParams(toggleQuickFilter(filter.id, params), { replace: true })}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[0.8125rem] font-medium whitespace-nowrap ${
                    active
                      ? 'border-seal bg-seal text-white'
                      : 'border-rule-strong bg-sheet text-ink-2 hover:border-seal/60 hover:text-ink'
                  }`}
                >
                  <Icon size={14} aria-hidden />
                  {filter.label}
                </button>
              )
            })}
            <span aria-hidden className="mx-1 h-5 w-px bg-rule" />
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((open) => !open)}
            >
              <ListFilter size={14} aria-hidden />
              상세 필터
              {activeFilters > 0 && (
                <span className="rounded bg-seal-soft px-1 text-xs text-seal-dark tabular-nums">{activeFilters}</span>
              )}
              <ChevronDown size={14} className={filtersOpen ? 'rotate-180' : ''} aria-hidden />
            </Button>
            {hasFilters(params) && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                필터 지우기
              </Button>
            )}
          </div>
        </div>
        {filtersOpen && <AuditFilters params={params} actors={actors} onChange={changeFilter} />}
      </Sheet>

      {logs.isPending && <Spinner />}
      {logs.isError && <ErrorState error={logs.error} onRetry={() => logs.refetch()} />}
      {logs.isSuccess && (
        <Sheet flush>
          {items.length === 0 ? (
            hasFilters(params) ? (
              <EmptyState title="조건에 맞는 기록이 없습니다" action={<Button onClick={clearFilters}>필터 지우기</Button>}>
                필터를 줄이거나 기간을 넓혀 보세요.
              </EmptyState>
            ) : (
              <EmptyState title="아직 기록이 없습니다">요청, 승인, 실행이 일어나면 이곳에 쌓입니다.</EmptyState>
            )
          ) : (
            <table className="sheet-table min-w-[56rem] [&_td]:py-1.5 [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th:first-child]:rounded-tl-xl [&_th:last-child]:rounded-tr-xl">
              <thead>
                <tr>
                  <th scope="col">시각</th>
                  <th scope="col">사용자</th>
                  <th scope="col">액션</th>
                  <th scope="col">대상</th>
                  <th scope="col">접속 환경</th>
                  <th scope="col">IP</th>
                </tr>
              </thead>
              <tbody>
                {items.map((log) => (
                  <tr
                    key={log.id}
                    data-clickable="true"
                    tabIndex={0}
                    aria-label={`${log.actor.name} ${AUDIT_ACTION_LABEL[log.action] ?? log.action} 상세 열기`}
                    className={isDangerAction(log.action) ? 'bg-high-soft/40' : ''}
                    onClick={() => setSelectedId(log.id)}
                    onKeyDown={(event) => {
                      if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                        event.preventDefault()
                        setSelectedId(log.id)
                      }
                    }}
                  >
                    <td className="whitespace-nowrap text-ink-2 tabular-nums">{formatDateTime(log.at)}</td>
                    <td className="whitespace-nowrap">
                      <ActorChip actor={log.actor} />
                    </td>
                    <td className="whitespace-nowrap">
                      <AuditActionLabel action={log.action} />
                    </td>
                    <td>
                      <TargetCell log={log} />
                    </td>
                    <td>
                      <NetworkBadge network={log.network} />
                    </td>
                    <td>
                      <Mono className="text-ink-2">{log.ip}</Mono>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {logs.hasNextPage && (
            <div className="flex justify-center border-t border-rule p-3">
              <Button loading={logs.isFetchingNextPage} onClick={() => logs.fetchNextPage()}>
                더 보기
              </Button>
            </div>
          )}
        </Sheet>
      )}

      <AuditDetailDrawer logId={selectedId} onClose={() => setSelectedId(null)} />
    </>
  )
}
