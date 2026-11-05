import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { RiskBadge } from '../../components/badges'
import { SegmentedTabs } from '../../components/rich'
import { ErrorState, Spinner } from '../../components/ui'
import { formatElapsed } from '../../lib/format'
import { usePendingApprovals } from '../../lib/queries'
import { groupByRequest, isOverdue, riskiestTask, type QueueGroup } from './queueGroups'

type FilterId = 'all' | 'high'

const FILTERS: Record<FilterId, { label: string; match: (group: QueueGroup) => boolean }> = {
  all: { label: '전체', match: () => true },
  high: { label: '높음', match: (group) => group.tasks.some((item) => item.task.risk === 'HIGH') },
}

const FILTER_IDS: FilterId[] = ['all', 'high']

function QueueItem({ group, selected }: { group: QueueGroup; selected: boolean }) {
  const top = riskiestTask(group)
  const others = group.tasks.length - 1
  return (
    <li>
      <Link
        to={`/approvals/${group.requestId}`}
        aria-current={selected ? 'true' : undefined}
        title={group.tasks.map((item) => item.task.title).join(', ')}
        className={`block px-5 py-3 ${selected ? 'bg-seal-soft shadow-[inset_3px_0_0_var(--color-seal)]' : 'hover:bg-sheet-alt'}`}
      >
        <div className="flex items-start gap-2">
          <span className={`line-clamp-2 min-w-0 flex-1 text-base text-ink ${selected ? 'font-semibold' : 'font-medium'}`}>
            {top.task.title}
            {others > 0 && ` 외 ${others}건`}
          </span>
          <RiskBadge risk={top.task.risk} />
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-sm text-ink-3">
          <span className="min-w-0 truncate">
            {group.requester.name}, <span className="sr-only">대기 시간 </span>
            <span className={isOverdue(group.requestedAt) ? 'font-medium text-medium' : ''}>
              {formatElapsed(group.requestedAt)}
            </span>
          </span>
        </div>
      </Link>
    </li>
  )
}

/** 왼쪽 목록: 내 승인이 필요한 요청을 오래 기다린 순으로 보여 준다. */
export function ApprovalQueue({ selectedId }: { selectedId?: string }) {
  const pending = usePendingApprovals()
  const groups = useMemo(() => groupByRequest(pending.data ?? []), [pending.data])
  const [filter, setFilter] = useState<FilterId>('all')
  const visible = groups.filter(FILTERS[filter].match)

  return (
    <div className="flex w-[18rem] shrink-0 flex-col border-r border-rule bg-sheet">
      <div className="flex flex-col gap-3 px-5 pt-5 pb-3">
        <h1 className="text-xl font-semibold">승인 대기</h1>
        {groups.length > 0 && (
          <div>
            <SegmentedTabs
              label="승인 대기 필터"
              value={filter}
              onChange={setFilter}
              items={FILTER_IDS.map((id) => ({
                id,
                label: FILTERS[id].label,
                count: groups.filter(FILTERS[id].match).length,
              }))}
            />
          </div>
        )}
      </div>

      <div className="quiet-scroll min-h-0 flex-1 overflow-y-auto pb-2">
        {pending.isPending && <Spinner />}
        {pending.isError && <ErrorState error={pending.error} onRetry={() => pending.refetch()} />}
        {pending.isSuccess && visible.length === 0 && (
          <p className="px-3 py-10 text-center text-sm text-ink-3">
            {groups.length === 0 ? '기다리는 승인이 없습니다.' : '이 조건에 맞는 요청이 없습니다.'}
          </p>
        )}
        <ul aria-label="승인 대기 요청" className="divide-y divide-rule border-y border-rule">
          {visible.map((group) => (
            <QueueItem key={group.requestId} group={group} selected={group.requestId === selectedId} />
          ))}
        </ul>
      </div>
    </div>
  )
}
