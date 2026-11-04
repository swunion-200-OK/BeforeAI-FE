import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { RiskBadge } from '../../components/badges'
import { SegmentedTabs } from '../../components/rich'
import { ErrorState, Spinner } from '../../components/ui'
import { formatElapsed } from '../../lib/format'
import { useIsExternal, usePendingApprovals } from '../../lib/queries'
import { groupByRequest, isOverdue, riskiestTask, type QueueGroup } from './queueGroups'

type FilterId = 'all' | 'high' | 'blocked'

const allBlocked = (group: QueueGroup) => group.tasks.every((task) => task.blockedReason)
const someBlocked = (group: QueueGroup) => group.tasks.some((task) => task.blockedReason)

const FILTERS: Record<FilterId, { label: string; match: (group: QueueGroup) => boolean }> = {
  all: { label: '전체', match: () => true },
  high: { label: '높음', match: (group) => group.tasks.some((task) => task.risk === 'HIGH') },
  blocked: { label: '내부망 필요', match: allBlocked },
}

function QueueItem({ group, selected }: { group: QueueGroup; selected: boolean }) {
  const top = riskiestTask(group)
  const others = group.tasks.length - 1
  const blockedLabel = allBlocked(group) ? '내부망 승인 필요' : someBlocked(group) ? '일부 내부망 승인 필요' : null
  return (
    <li>
      <Link
        to={`/approvals/${group.requestId}`}
        aria-current={selected ? 'true' : undefined}
        title={group.tasks.map((task) => task.taskTitle).join(', ')}
        className={`block rounded-lg px-3 py-3 ${selected ? 'bg-seal-soft ring-1 ring-seal/40' : 'hover:bg-sheet-alt'}`}
      >
        <div className="flex items-start gap-2">
          <span className="line-clamp-2 min-w-0 flex-1 text-base font-semibold text-ink">
            {top.taskTitle}
            {others > 0 && ` 외 ${others}건`}
          </span>
          <RiskBadge risk={top.risk} />
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-sm text-ink-3">
          <span className="min-w-0 truncate">
            {group.requester.name}, <span className="sr-only">대기 시간 </span>
            <span className={isOverdue(group.requestedAt) ? 'font-medium text-medium' : ''}>
              {formatElapsed(group.requestedAt)}
            </span>
          </span>
          {blockedLabel && <span className="shrink-0 text-xs text-external">{blockedLabel}</span>}
        </div>
      </Link>
    </li>
  )
}

/** 왼쪽 목록: 내 승인이 필요한 요청을 오래 기다린 순으로 보여 준다. */
export function ApprovalQueue({ selectedId }: { selectedId?: string }) {
  const pending = usePendingApprovals()
  const external = useIsExternal()
  const groups = useMemo(() => groupByRequest(pending.data ?? []), [pending.data])
  const [chosenFilter, setFilter] = useState<FilterId>('all')

  // 망을 바꾸면 고를 수 있는 필터가 달라지므로, 없는 필터는 전체로 되돌린다.
  const filterIds: FilterId[] = external ? ['all', 'blocked'] : ['all', 'high']
  const filter = filterIds.includes(chosenFilter) ? chosenFilter : 'all'
  const visible = groups.filter(FILTERS[filter].match)

  return (
    <div className="flex w-[18rem] shrink-0 flex-col border-r border-rule bg-sheet">
      <div className="flex flex-col gap-3 px-5 pt-5 pb-3">
        <h1 className="text-xl font-bold tracking-tight">승인 대기</h1>
        {groups.length > 0 && (
          <div>
            <SegmentedTabs
              label="승인 대기 필터"
              value={filter}
              onChange={setFilter}
              items={filterIds.map((id) => ({
                id,
                label: FILTERS[id].label,
                count: groups.filter(FILTERS[id].match).length,
              }))}
            />
          </div>
        )}
      </div>

      <div className="quiet-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {pending.isPending && <Spinner />}
        {pending.isError && <ErrorState error={pending.error} onRetry={() => pending.refetch()} />}
        {pending.isSuccess && visible.length === 0 && (
          <p className="px-3 py-10 text-center text-sm text-ink-3">
            {groups.length === 0 ? '기다리는 승인이 없습니다.' : '이 조건에 맞는 요청이 없습니다.'}
          </p>
        )}
        <ul aria-label="승인 대기 요청" className="flex flex-col gap-0.5">
          {visible.map((group) => (
            <QueueItem key={group.requestId} group={group} selected={group.requestId === selectedId} />
          ))}
        </ul>
      </div>
    </div>
  )
}
