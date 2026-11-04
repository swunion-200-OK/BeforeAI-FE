import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { auditApi } from '../../api/endpoints'
import type { AuditLog, Role } from '../../api/types'
import { useMe } from '../../app/AuthProvider'
import { NetworkBadge } from '../../components/badges'
import { Button, EmptyState, ErrorState, Mono, PageHeader, Sheet, Spinner } from '../../components/ui'
import { formatDateTime } from '../../lib/format'
import { AUDIT_ACTION_LABEL } from '../../lib/labels'
import { AuditDetailDrawer } from './AuditDetailDrawer'
import { AuditFilters } from './AuditFilters'
import { hasFilters, toAuditQuery, type FilterKey } from './auditFilters'

const PAGE_SIZE = 30

const SCOPE_TEXT: Record<Role, string> = {
  ADMIN: '회사 전체의 기록을 봅니다.',
  DEPT_MANAGER: '소속 부서의 기록만 보입니다.',
  EMPLOYEE: '본인 요청에 대한 기록만 보입니다.',
}

function TargetCell({ log }: { log: AuditLog }) {
  const { requestId, taskIds, label } = log.target
  return (
    <div className="flex flex-col">
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
      {label && <span>{label}</span>}
      {!requestId && !label && <span className="text-ink-3">-</span>}
    </div>
  )
}

export default function AuditPage() {
  const me = useMe()
  const [params, setParams] = useSearchParams()
  const [selectedId, setSelectedId] = useState<string | null>(null)
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

  return (
    <>
      <PageHeader title="감사 로그" description={`모든 요청, 승인, 실행 기록을 접속 환경과 함께 남깁니다. ${SCOPE_TEXT[me.role]}`} />

      <AuditFilters
        params={params}
        actors={actors}
        onChange={changeFilter}
        onReset={() => setParams(new URLSearchParams(), { replace: true })}
      />

      {logs.isPending && <Spinner />}
      {logs.isError && <ErrorState error={logs.error} onRetry={() => logs.refetch()} />}
      {logs.isSuccess && (
        <Sheet flush>
          {items.length === 0 ? (
            hasFilters(params) ? (
              <EmptyState
                title="조건에 맞는 기록이 없습니다"
                action={<Button onClick={() => setParams(new URLSearchParams(), { replace: true })}>필터 지우기</Button>}
              >
                필터를 줄이거나 기간을 넓혀 보세요.
              </EmptyState>
            ) : (
              <EmptyState title="아직 기록이 없습니다">요청, 승인, 실행이 일어나면 이곳에 쌓입니다.</EmptyState>
            )
          ) : (
            <div className="overflow-x-auto">
              <table className="sheet-table min-w-[44rem]">
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
                      onClick={() => setSelectedId(log.id)}
                      onKeyDown={(event) => {
                        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                          event.preventDefault()
                          setSelectedId(log.id)
                        }
                      }}
                    >
                      <td className="whitespace-nowrap tabular-nums">{formatDateTime(log.at)}</td>
                      <td className="whitespace-nowrap">{log.actor.name}</td>
                      <td className="whitespace-nowrap">{AUDIT_ACTION_LABEL[log.action] ?? log.action}</td>
                      <td>
                        <TargetCell log={log} />
                      </td>
                      <td>
                        <NetworkBadge network={log.network} />
                      </td>
                      <td>
                        <Mono>{log.ip}</Mono>
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
      )}

      <AuditDetailDrawer logId={selectedId} onClose={() => setSelectedId(null)} />
    </>
  )
}
