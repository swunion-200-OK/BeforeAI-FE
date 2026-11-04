import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  ChevronRight,
  ClipboardCheck,
  Globe,
  History,
  LoaderCircle,
  OctagonX,
  ShieldHalf,
  TableProperties,
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { auditApi, requestsApi } from '../../api/endpoints'
import type { Dashboard, DepartmentStat, RequestStatus, Risk } from '../../api/types'
import { NetworkBadge, RequestStatusBadge, RiskBadge } from '../../components/badges'
import { Donut, Meter, ProjectTag, TaskProgress } from '../../components/rich'
import { Button, EmptyState, ErrorState, Sheet, Spinner } from '../../components/ui'
import { formatElapsed } from '../../lib/format'
import { useDepartmentNames, usePendingApprovals, useProjects } from '../../lib/queries'
import { KillAllDialog } from '../admin/KillAllDialog'
import { ActorChip } from '../audit/ActorChip'
import { AuditActionLabel } from '../audit/AuditActionLabel'
import { ATTENTION_STATUSES } from './statusGroups'

const ago = (iso: string) => {
  const elapsed = formatElapsed(iso)
  return elapsed === '방금' ? elapsed : `${elapsed} 전`
}

/** Sheet 본문이 칸 높이를 끝까지 쓰게 한다. 옆 칸과 높이가 달라도 아래 줄이 맞는다. */
const FILL = 'flex flex-col [&>div:last-child]:flex [&>div:last-child]:flex-1 [&>div:last-child]:flex-col'

function SeeAll({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex items-center gap-0.5 text-[0.8125rem] font-medium text-seal hover:underline">
      {children}
      <ChevronRight size={14} aria-hidden />
    </Link>
  )
}

// ── 내가 지금 할 일 ─────────────────────────────────────────

const PENDING_LIMIT = 5

export function TodoPanel() {
  const pending = usePendingApprovals()
  const departmentName = useDepartmentNames()
  const items = pending.data ?? []
  return (
    <Sheet
      title="내가 지금 할 일"
      icon={<ClipboardCheck size={16} aria-hidden />}
      actions={items.length > 0 ? <SeeAll to="/approvals">전체 {items.length}건</SeeAll> : undefined}
      flush
      className={FILL}
    >
      {pending.isPending && <Spinner />}
      {pending.isError && <ErrorState error={pending.error} onRetry={() => pending.refetch()} />}
      {pending.isSuccess && items.length === 0 && (
        <div className="my-auto">
          <EmptyState title="지금 승인할 작업이 없습니다">승인 요청이 오면 Slack 알림과 함께 이곳에 나타납니다.</EmptyState>
        </div>
      )}
      {items.length > 0 && (
        <ul className="divide-y divide-rule">
          {items.slice(0, PENDING_LIMIT).map((item) => (
            <li key={`${item.requestId}-${item.taskId}`}>
              <Link
                to={`/approvals/${item.requestId}`}
                className="grid grid-cols-[3.75rem_minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-2 hover:bg-seal-soft/40"
              >
                <span>
                  <RiskBadge risk={item.risk} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">{item.taskTitle}</span>
                  <span className="flex min-w-0 items-center gap-2">
                    <ProjectTag name={item.projectName} />
                    <span className="truncate text-xs text-ink-3">
                      {item.requester.name}, {departmentName(item.requester.departmentId)}
                    </span>
                  </span>
                </span>
                <span className="flex flex-col items-end gap-0.5 text-xs whitespace-nowrap text-ink-3">
                  <span className="tabular-nums">{formatElapsed(item.requestedAt)} 대기</span>
                  {item.blockedReason && (
                    <span className="inline-flex items-center gap-1 rounded bg-external-soft px-1.5 font-medium text-external">
                      <Globe size={11} aria-hidden />
                      내부망 승인 필요
                    </span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}

// ── 실행 중 ─────────────────────────────────────────────────

const RUNNING_LIMIT = 5

export function RunningPanel({ canKillAll, listTo }: { canKillAll: boolean; listTo: string }) {
  const [killOpen, setKillOpen] = useState(false)
  const projects = useProjects()
  const projectNames = useMemo(() => new Map(projects.data?.map((p) => [p.id, p.name])), [projects.data])
  const running = useQuery({
    queryKey: ['dashboard', 'running'],
    queryFn: () => requestsApi.list({ status: 'RUNNING', limit: 100 }),
    refetchInterval: 3000,
  })
  const items = running.data?.items ?? []
  return (
    <Sheet
      title="실행 중"
      icon={<LoaderCircle size={16} className={items.length ? 'animate-spin text-internal' : ''} aria-hidden />}
      actions={items.length > 0 ? <SeeAll to={listTo}>전체 {items.length}건</SeeAll> : undefined}
      flush
      className={FILL}
    >
      {running.isPending && <Spinner />}
      {running.isError && <ErrorState error={running.error} onRetry={() => running.refetch()} />}
      {running.isSuccess && items.length === 0 && (
        <div className="my-auto">
          <EmptyState title="실행 중인 작업이 없습니다">승인이 모이면 실행기가 검증한 뒤 이곳에서 진행 상황을 보여 줍니다.</EmptyState>
        </div>
      )}
      {items.length > 0 && (
        <ul className="divide-y divide-rule">
          {items.slice(0, RUNNING_LIMIT).map((request) => (
            <li key={request.id}>
              <Link to={`/requests/${request.id}`} className="block px-4 py-2 hover:bg-seal-soft/40">
                <span className="block truncate text-sm font-medium text-ink">{request.prompt}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  <ProjectTag name={projectNames.get(request.projectId) ?? request.projectId} />
                  {request.taskSummary && <TaskProgress summary={request.taskSummary} />}
                  <span className="ml-auto text-xs whitespace-nowrap text-ink-3 tabular-nums">{ago(request.updatedAt)} 시작</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {canKillAll && (
        <>
          <div className="mt-auto flex items-center justify-between gap-3 border-t border-rule px-4 py-2">
            <p className="text-xs text-ink-3">급할 때 실행 중인 요청을 모두 멈춥니다.</p>
            <Button
              variant="danger-outline"
              size="sm"
              disabled={items.length === 0}
              disabledReason="실행 중인 요청이 없습니다"
              onClick={() => setKillOpen(true)}
            >
              <OctagonX size={14} aria-hidden />
              전사 일괄 중단
            </Button>
          </div>
          <KillAllDialog open={killOpen} onClose={() => setKillOpen(false)} />
        </>
      )}
    </Sheet>
  )
}

// ── 위험도 분포 ─────────────────────────────────────────────

const RISK_ORDER: Risk[] = ['FORBIDDEN', 'HIGH', 'MEDIUM', 'LOW']
const RISK_COLOR: Record<Risk, string> = {
  LOW: 'var(--color-low)',
  MEDIUM: 'var(--color-medium)',
  HIGH: 'var(--color-high)',
  FORBIDDEN: 'var(--color-forbidden)',
}

export function RiskPanel({ distribution }: { distribution: Dashboard['riskDistribution'] }) {
  const total = RISK_ORDER.reduce((sum, risk) => sum + distribution[risk], 0)
  return (
    <Sheet title="위험도 분포" icon={<ShieldHalf size={16} aria-hidden />} className={FILL}>
      {total === 0 ? (
        <div className="my-auto">
          <EmptyState title="아직 분석이 끝난 작업이 없습니다">작업을 요청하면 AI가 나눈 작업의 위험도가 이곳에 모입니다.</EmptyState>
        </div>
      ) : (
        <div className="flex items-center gap-5">
          <Donut
            size={128}
            segments={RISK_ORDER.map((risk) => ({ value: distribution[risk], color: RISK_COLOR[risk], label: risk }))}
            center={
              <>
                <span className="text-xl leading-none font-bold tabular-nums">{total}</span>
                <span className="mt-0.5 text-xs text-ink-3">작업</span>
              </>
            }
          />
          <ul className="flex min-w-0 flex-1 flex-col gap-2">
            {RISK_ORDER.map((risk) => {
              const value = distribution[risk]
              return (
                <li key={risk} className="flex items-center justify-between gap-2">
                  <RiskBadge risk={risk} />
                  <span className="text-sm whitespace-nowrap tabular-nums">
                    <span className="font-semibold">{value}건</span>{' '}
                    <span className="text-xs text-ink-3">{Math.round((value / total) * 100)}%</span>
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {riskNote(distribution) && <p className="mt-3 text-xs text-ink-2">{riskNote(distribution)}</p>}
    </Sheet>
  )
}

/** 숫자가 무슨 뜻인지 승인 기준표(5.2)에 맞춰 말로 풀어 쓴다. */
function riskNote(distribution: Dashboard['riskDistribution']): string | null {
  const parts = [
    distribution.HIGH > 0 ? `높음 ${distribution.HIGH}건은 프로젝트 담당자 승인이 필요합니다` : null,
    distribution.FORBIDDEN > 0 ? `금지 ${distribution.FORBIDDEN}건은 실행이 막혀 있습니다` : null,
  ].filter(Boolean)
  return parts.length > 0 ? `${parts.join('. ')}.` : null
}

// ── 상태별 건수 ─────────────────────────────────────────────

const STATUS_GROUPS: Array<{ label: string; bar: string; statuses: RequestStatus[] }> = [
  {
    label: '확인 필요',
    bar: 'bg-high',
    statuses: ATTENTION_STATUSES,
  },
  {
    label: '진행 중',
    bar: 'bg-seal',
    statuses: ['ANALYZING', 'REVIEWING', 'PENDING_APPROVAL', 'RUNNING', 'ROLLING_BACK'],
  },
  {
    label: '끝남',
    bar: 'bg-rule-strong',
    statuses: ['COMPLETED', 'ROLLED_BACK', 'KILLED', 'REJECTED', 'CANCELED'],
  },
]

export function StatusPanel({
  counts,
  statusTo,
}: {
  counts: Dashboard['statusCounts']
  statusTo: (status: RequestStatus) => string
}) {
  const navigate = useNavigate()
  const max = Math.max(0, ...Object.values(counts).map((value) => value ?? 0))
  const groups = STATUS_GROUPS.map((group) => {
    const statuses = group.statuses.filter((status) => (counts[status] ?? 0) > 0)
    return { ...group, statuses, sum: statuses.reduce((sum, status) => sum + (counts[status] ?? 0), 0) }
  }).filter((group) => group.statuses.length > 0)

  return (
    <Sheet title="상태별 건수" icon={<Activity size={16} aria-hidden />} className="flex-1">
      {groups.length === 0 ? (
        <EmptyState
          title="아직 요청이 없습니다"
          action={
            <Button variant="primary" internalOnly onClick={() => navigate('/requests/new')}>
              작업 요청하기
            </Button>
          }
        >
          작업을 요청하면 상태와 위험도가 이곳에 모입니다.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-3 gap-x-6">
          {groups.map((group) => (
            <div key={group.label} className="min-w-0">
              <h3 className="mb-1 flex items-baseline justify-between text-[0.8125rem] font-medium text-ink-2">
                {group.label}
                <span className="text-ink-3 tabular-nums">{group.sum}건</span>
              </h3>
              <ul>
                {group.statuses.map((status) => {
                  const value = counts[status] ?? 0
                  return (
                    <li key={status}>
                      <Link
                        to={statusTo(status)}
                        className="-mx-1.5 grid grid-cols-[minmax(0,5.75rem)_minmax(0,1fr)_1.25rem] items-center gap-2 rounded px-1.5 py-[3px] hover:bg-seal-soft/40"
                      >
                        <span>
                          <RequestStatusBadge status={status} />
                        </span>
                        <Meter value={value} max={max} className={group.bar} />
                        <span className="text-right text-[0.8125rem] font-medium tabular-nums">{value}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  )
}

// ── 부서별 비교 ─────────────────────────────────────────────

const DEPARTMENT_MEASURES: Array<{ key: 'requests' | 'pendingApprovals' | 'running'; label: string }> = [
  { key: 'requests', label: '요청' },
  { key: 'pendingApprovals', label: '승인 대기' },
  { key: 'running', label: '실행 중' },
]

/** 부서별 비교. 항목마다 열을 나눠 색 대신 위치로 구분하고, 눈금은 세 열이 같다. */
export function DepartmentPanel({ departments }: { departments: DepartmentStat[] }) {
  const max = Math.max(
    0,
    ...departments.flatMap((department) => DEPARTMENT_MEASURES.map(({ key }) => department[key])),
  )
  return (
    <Sheet title="부서별 비교" icon={<TableProperties size={16} aria-hidden />} flush>
      <table className="sheet-table [&_td]:py-2">
        <thead>
          <tr>
            <th scope="col">부서</th>
            {DEPARTMENT_MEASURES.map(({ key, label }) => (
              <th key={key} scope="col" className="w-1/4">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {departments.map((department) => (
            <tr key={department.departmentId}>
              <td className="font-medium whitespace-nowrap text-ink">{department.name}</td>
              {DEPARTMENT_MEASURES.map(({ key, label }) => (
                <td key={key} title={`${department.name} ${label}: ${department[key]}건`}>
                  <div className="flex items-center gap-2">
                    <Meter value={department[key]} max={max} />
                    <span className="w-8 shrink-0 text-right tabular-nums">{department[key]}건</span>
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Sheet>
  )
}

// ── 최근 활동 ───────────────────────────────────────────────

const ACTIVITY_LIMIT = 8

export function ActivityPanel() {
  const activity = useQuery({
    queryKey: ['audit-logs', 'dashboard-activity'],
    queryFn: () => auditApi.list({ limit: ACTIVITY_LIMIT }),
    refetchInterval: 10_000,
  })
  const items = activity.data?.items ?? []
  return (
    <Sheet
      title="최근 활동"
      icon={<History size={16} aria-hidden />}
      actions={<SeeAll to="/audit">감사 로그</SeeAll>}
      flush
      className={`h-full ${FILL}`}
    >
      {activity.isPending && <Spinner />}
      {activity.isError && <ErrorState error={activity.error} onRetry={() => activity.refetch()} />}
      {activity.isSuccess && items.length === 0 && (
        <div className="my-auto">
          <EmptyState title="아직 기록이 없습니다">요청, 승인, 실행이 일어나면 이곳에 쌓입니다.</EmptyState>
        </div>
      )}
      {items.length > 0 && (
        <ul className="grid flex-1 auto-rows-fr divide-y divide-rule">
          {items.map((log) => (
            <li key={log.id} className="flex items-center gap-2.5 px-4 py-1.5 text-[0.8125rem]">
              <span className="w-[5.25rem] shrink-0">
                <ActorChip actor={log.actor} />
              </span>
              <span className="shrink-0">
                <AuditActionLabel action={log.action} />
              </span>
              <span className="min-w-0 flex-1 truncate">
                {log.target.requestId ? (
                  <Link to={`/requests/${log.target.requestId}`} className="font-mono text-xs text-seal hover:underline">
                    {log.target.requestId}
                  </Link>
                ) : (
                  <span className="text-xs text-ink-3">{log.target.label}</span>
                )}
              </span>
              <NetworkBadge network={log.network} />
              <span className="w-[4.75rem] shrink-0 text-right text-xs text-ink-3 tabular-nums">{ago(log.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}
