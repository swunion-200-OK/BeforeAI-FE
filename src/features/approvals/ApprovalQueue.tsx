import { Clock, Globe, Inbox } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import type { Risk } from '../../api/types'
import { RiskBadge } from '../../components/badges'
import { ProjectTag, SegmentedTabs, UserChip } from '../../components/rich'
import { ErrorState, Spinner } from '../../components/ui'
import { formatDateTime, formatElapsed } from '../../lib/format'
import { useDepartmentNames, useIsExternal, usePendingApprovals } from '../../lib/queries'
import { groupByRequest, isOverdue, type QueueGroup } from './queueGroups'

type FilterId = 'all' | 'high' | 'lower' | 'ready' | 'blocked'

const hasRisk = (group: QueueGroup, ...risks: Risk[]) => group.tasks.some((task) => risks.includes(task.risk))
const isBlocked = (group: QueueGroup) => group.tasks.some((task) => task.blockedReason)
const isReady = (group: QueueGroup) => group.tasks.some((task) => !task.blockedReason)

const FILTERS: Record<FilterId, (group: QueueGroup) => boolean> = {
  all: () => true,
  high: (group) => hasRisk(group, 'HIGH'),
  lower: (group) => !hasRisk(group, 'HIGH'),
  ready: isReady,
  blocked: isBlocked,
}

function WaitTime({ since }: { since: string }) {
  const overdue = isOverdue(since)
  return (
    <span
      title={`요청 시각 ${formatDateTime(since)}`}
      className={`inline-flex shrink-0 items-center gap-1 text-xs tabular-nums ${overdue ? 'font-medium text-medium' : 'text-ink-3'}`}
    >
      <Clock size={12} aria-hidden />
      <span className="sr-only">대기 시간 </span>
      {formatElapsed(since)}
    </span>
  )
}

function QueueItem({ group, selected }: { group: QueueGroup; selected: boolean }) {
  const departmentName = useDepartmentNames()
  return (
    <li>
      <Link
        to={`/approvals/${group.requestId}`}
        aria-current={selected ? 'true' : undefined}
        className={`relative block border-b border-rule px-3.5 py-3 ${selected ? 'bg-seal-soft' : 'hover:bg-sheet-alt'}`}
      >
        {selected && <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-seal" />}
        <div className="flex items-start justify-between gap-2">
          <UserChip name={group.requester.name} sub={departmentName(group.requester.departmentId)} />
          <WaitTime since={group.requestedAt} />
        </div>
        <ul className="mt-2 flex flex-col gap-1.5">
          {group.tasks.map((task) => (
            <li key={task.taskId} className="min-w-0">
              <div className="flex min-w-0 items-center gap-1.5">
                <RiskBadge risk={task.risk} />
                <span className="truncate text-[0.8125rem] font-medium text-ink" title={task.taskTitle}>
                  {task.taskTitle}
                </span>
              </div>
              {task.blockedReason && (
                <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-external">
                  <Globe size={12} aria-hidden />
                  내부망 승인 필요
                </p>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-2">
          <ProjectTag name={group.projectName} />
        </div>
      </Link>
    </li>
  )
}

/** 왼쪽 받은편지함: 내 승인이 필요한 요청을 오래 기다린 순으로 보여 준다. */
export function ApprovalQueue({ selectedId }: { selectedId?: string }) {
  const pending = usePendingApprovals()
  const external = useIsExternal()
  const groups = useMemo(() => groupByRequest(pending.data ?? []), [pending.data])
  const [chosenFilter, setFilter] = useState<FilterId>('all')

  // 망을 바꾸면 고를 수 있는 필터가 달라지므로, 없는 필터는 전체로 되돌린다.
  const filterIds: FilterId[] = external ? ['all', 'ready', 'blocked'] : ['all', 'high', 'lower']
  const filter = filterIds.includes(chosenFilter) ? chosenFilter : 'all'
  const labels: Record<FilterId, string> = {
    all: '전체',
    high: '위험 높음',
    lower: '낮음·중간',
    ready: '지금 승인 가능',
    blocked: '내부망 필요',
  }
  const visible = groups.filter(FILTERS[filter])
  const selectedOutside = Boolean(selectedId) && pending.isSuccess && !groups.some((g) => g.requestId === selectedId)

  return (
    <div className="flex w-[330px] shrink-0 flex-col border-r border-rule bg-sheet">
      <div className="border-b border-rule px-3.5 pt-3.5 pb-3">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="flex items-center gap-2 text-[1.0625rem] font-bold tracking-tight">
            <Inbox size={18} className="text-seal" aria-hidden />
            승인 대기
          </h1>
          <span className="text-xs text-ink-3">오래 기다린 순</span>
        </div>
        <div className="mt-2.5">
          <SegmentedTabs
            label="승인 대기 필터"
            value={filter}
            onChange={setFilter}
            items={filterIds.map((id) => ({
              id,
              label: labels[id],
              count: groups.filter(FILTERS[id]).length,
            }))}
          />
        </div>
      </div>

      {selectedOutside && (
        <p className="border-b border-rule bg-sheet-alt px-3.5 py-2 text-xs text-ink-2">
          지금 보는 요청은 내 승인 대기에 없습니다.
        </p>
      )}

      <div className="quiet-scroll min-h-0 flex-1 overflow-y-auto">
        {pending.isPending && <Spinner />}
        {pending.isError && <ErrorState error={pending.error} onRetry={() => pending.refetch()} />}
        {pending.isSuccess && visible.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-ink-3">
            {groups.length === 0 ? '기다리는 승인이 없습니다.' : '이 조건에 맞는 요청이 없습니다.'}
          </p>
        )}
        <ul aria-label="승인 대기 요청">
          {visible.map((group) => (
            <QueueItem key={group.requestId} group={group} selected={group.requestId === selectedId} />
          ))}
        </ul>
      </div>
    </div>
  )
}
