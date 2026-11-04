import { useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { requestsApi } from '../../api/endpoints'
import type { Dashboard, DepartmentStat, RequestStatus, Risk } from '../../api/types'
import { RequestStatusBadge, RiskBadge } from '../../components/badges'
import { TaskProgress } from '../../components/rich'
import { Button, ErrorState, Sheet, Spinner } from '../../components/ui'
import { formatElapsed } from '../../lib/format'
import { usePendingApprovals } from '../../lib/queries'
import { KillAllDialog } from '../admin/KillAllDialog'
import { groupByRequest, riskiestTask } from '../approvals/queueGroups'
import { ATTENTION_STATUSES } from './statusGroups'

function SeeAll({ to, count }: { to: string; count: number }) {
  return (
    <Link to={to} className="text-sm font-medium text-seal hover:underline">
      전체 {count}건
    </Link>
  )
}

// ── 내가 지금 할 일 ─────────────────────────────────────────

const PENDING_LIMIT = 7

export function TodoPanel({ emptyText, className }: { emptyText: string; className?: string }) {
  const pending = usePendingApprovals()
  // 승인 대기 목록과 같게 요청 하나를 한 줄로 보여 준다.
  const items = groupByRequest(pending.data ?? [])
  return (
    <Sheet
      title="내가 지금 할 일"
      actions={items.length > PENDING_LIMIT ? <SeeAll to="/approvals" count={items.length} /> : undefined}
      flush
      className={className}
    >
      {pending.isPending && <Spinner />}
      {pending.isError && <ErrorState error={pending.error} onRetry={() => pending.refetch()} />}
      {pending.isSuccess && items.length === 0 && <p className="px-4 py-5 text-sm text-ink-2">{emptyText}</p>}
      {items.length > 0 && (
        <ul className="divide-y divide-rule">
          {items.slice(0, PENDING_LIMIT).map((group) => {
            const top = riskiestTask(group)
            const blocked = group.tasks.filter((task) => task.blockedReason).length
            return (
              <li key={group.requestId}>
                <Link
                  to={`/approvals/${group.requestId}`}
                  className="grid grid-cols-[4.25rem_minmax(0,1fr)_12rem_7.5rem] items-center gap-x-4 px-4 py-3.5 hover:bg-seal-soft/40"
                >
                  <span>
                    <RiskBadge risk={top.risk} />
                  </span>
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate text-[0.9375rem] font-medium text-ink">
                      {top.taskTitle}
                      {group.tasks.length > 1 && ` 외 ${group.tasks.length - 1}건`}
                    </span>
                    {blocked > 0 && (
                      <span className="shrink-0 text-xs font-medium text-external">
                        {blocked < group.tasks.length ? '일부 내부망 승인 필요' : '내부망 승인 필요'}
                      </span>
                    )}
                  </span>
                  <span className="truncate text-sm text-ink-2">
                    {group.requester.name}, {group.projectName}
                  </span>
                  <span className="text-right text-sm whitespace-nowrap text-ink-3 tabular-nums">
                    {formatElapsed(group.requestedAt)} 대기
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Sheet>
  )
}

// ── 실행 중 ─────────────────────────────────────────────────

const RUNNING_LIMIT = 5

const ago = (iso: string) => {
  const elapsed = formatElapsed(iso)
  return elapsed === '방금' ? elapsed : `${elapsed} 전`
}

/** 실행 중인 요청이 있을 때만 보인다. 없으면 일괄 중단할 대상도 없으므로 버튼까지 함께 숨는다. */
export function RunningPanel({
  canKillAll,
  listTo,
  className,
}: {
  canKillAll: boolean
  listTo: string
  className?: string
}) {
  const [killOpen, setKillOpen] = useState(false)
  const running = useQuery({
    queryKey: ['dashboard', 'running'],
    queryFn: () => requestsApi.list({ status: 'RUNNING', limit: 100 }),
    refetchInterval: 3000,
  })
  const items = running.data?.items ?? []
  return (
    <>
      {(items.length > 0 || running.isError) && (
        <Sheet
          title="실행 중"
          actions={
            <>
              {items.length > RUNNING_LIMIT && <SeeAll to={listTo} count={items.length} />}
              {canKillAll && (
                // 옆 패널과 제목 줄 높이가 같도록 버튼이 줄을 밀어내지 않게 한다.
                <Button variant="danger-outline" size="sm" className="-my-1.5" onClick={() => setKillOpen(true)}>
                  전사 일괄 중단
                </Button>
              )}
            </>
          }
          flush
          className={className}
        >
          {running.isError && <ErrorState error={running.error} onRetry={() => running.refetch()} />}
          {items.length > 0 && (
            <ul className="divide-y divide-rule">
              {items.slice(0, RUNNING_LIMIT).map((request) => (
                <li key={request.id}>
                  <Link to={`/requests/${request.id}`} className="block px-4 py-3.5 hover:bg-seal-soft/40">
                    <span className="block truncate text-sm font-medium text-ink">{request.prompt}</span>
                    <span className="mt-1.5 flex items-center gap-3">
                      {request.taskSummary && <TaskProgress summary={request.taskSummary} />}
                      <span className="ml-auto text-xs whitespace-nowrap text-ink-3 tabular-nums">
                        {ago(request.updatedAt)} 시작
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Sheet>
      )}
      {/* 입력 중에 실행이 모두 끝나도 창이 사라지지 않게 패널 밖에 둔다. */}
      {canKillAll && <KillAllDialog open={killOpen} onClose={() => setKillOpen(false)} />}
    </>
  )
}

// ── 현황 자세히 ─────────────────────────────────────────────

const RISK_ORDER: Risk[] = ['FORBIDDEN', 'HIGH', 'MEDIUM', 'LOW']

const STATUS_GROUPS: Array<{ label: string; statuses: RequestStatus[] }> = [
  { label: '확인 필요', statuses: ATTENTION_STATUSES },
  { label: '진행 중', statuses: ['ANALYZING', 'REVIEWING', 'PENDING_APPROVAL', 'RUNNING', 'ROLLING_BACK'] },
  { label: '끝남', statuses: ['COMPLETED', 'ROLLED_BACK', 'KILLED', 'REJECTED', 'CANCELED'] },
]

const DEPARTMENT_MEASURES: Array<{ key: 'requests' | 'pendingApprovals' | 'running'; label: string }> = [
  { key: 'requests', label: '요청' },
  { key: 'pendingApprovals', label: '승인 대기' },
  { key: 'running', label: '실행 중' },
]

const SUBTITLE = 'mb-3 text-sm font-medium text-ink-2'

function RiskDistribution({ distribution, total }: { distribution: Dashboard['riskDistribution']; total: number }) {
  return (
    <section>
      <h3 className={SUBTITLE}>위험도 분포</h3>
      <ul className="flex flex-col gap-2">
        {RISK_ORDER.map((risk) => (
          <li key={risk} className="flex items-center justify-between gap-3">
            <RiskBadge risk={risk} />
            <span className="text-sm whitespace-nowrap tabular-nums">
              <span className="font-medium">{distribution[risk]}건</span>{' '}
              <span className="text-ink-3">{Math.round((distribution[risk] / total) * 100)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function StatusCounts({
  groups,
  counts,
  statusTo,
}: {
  groups: typeof STATUS_GROUPS
  counts: Dashboard['statusCounts']
  statusTo: (status: RequestStatus) => string
}) {
  return (
    <section>
      <h3 className={SUBTITLE}>상태별 건수</h3>
      <div className="grid grid-cols-[repeat(3,minmax(0,11rem))] gap-x-10">
        {groups.map((group) => (
          <div key={group.label} className="min-w-0">
            <h4 className="mb-1.5 text-[0.8125rem] text-ink-3">{group.label}</h4>
            <ul>
              {group.statuses.map((status) => (
                <li key={status}>
                  <Link
                    to={statusTo(status)}
                    className="-mx-1.5 flex items-center justify-between gap-2 rounded px-1.5 py-1 hover:bg-seal-soft/40"
                  >
                    <RequestStatusBadge status={status} />
                    <span className="text-sm font-medium tabular-nums">{counts[status]}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}

function DepartmentCompare({ departments }: { departments: DepartmentStat[] }) {
  return (
    <section>
      <h3 className={SUBTITLE}>부서별 비교</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[0.8125rem] text-ink-3">
            <th scope="col" className="pb-1.5 text-left font-normal">
              부서
            </th>
            {DEPARTMENT_MEASURES.map(({ key, label }) => (
              <th key={key} scope="col" className="pb-1.5 pl-4 text-right font-normal whitespace-nowrap">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {departments.map((department) => (
            <tr key={department.departmentId}>
              <td className="py-1.5 font-medium whitespace-nowrap text-ink">{department.name}</td>
              {DEPARTMENT_MEASURES.map(({ key }) => (
                <td key={key} className="py-1.5 pl-4 text-right tabular-nums">
                  {department[key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

/** 명세가 요구하는 집계를 접어 둔다. 보여 줄 값이 하나도 없으면 칸 자체를 숨긴다. */
export function DashboardDetails({
  data,
  statusTo,
}: {
  data: Dashboard
  statusTo: (status: RequestStatus) => string
}) {
  const riskTotal = RISK_ORDER.reduce((sum, risk) => sum + data.riskDistribution[risk], 0)
  const groups = STATUS_GROUPS.map((group) => ({
    ...group,
    statuses: group.statuses.filter((status) => (data.statusCounts[status] ?? 0) > 0),
  })).filter((group) => group.statuses.length > 0)
  const departments = data.byDepartment ?? []

  if (riskTotal === 0 && groups.length === 0 && departments.length === 0) return null

  return (
    <details className="group rounded-xl border border-rule bg-sheet shadow-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-4 py-3 text-[0.9375rem] font-semibold hover:bg-sheet-alt [&::-webkit-details-marker]:hidden">
        현황 자세히
        <ChevronDown size={16} className="text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="flex flex-wrap gap-x-16 gap-y-6 border-t border-rule p-5">
        {riskTotal > 0 && (
          <div className="w-48 shrink-0">
            <RiskDistribution distribution={data.riskDistribution} total={riskTotal} />
          </div>
        )}
        {groups.length > 0 && (
          <div className="min-w-[28rem] flex-1">
            <StatusCounts groups={groups} counts={data.statusCounts} statusTo={statusTo} />
          </div>
        )}
        {departments.length > 0 && (
          <div className="w-80 shrink-0">
            <DepartmentCompare departments={departments} />
          </div>
        )}
      </div>
    </details>
  )
}
