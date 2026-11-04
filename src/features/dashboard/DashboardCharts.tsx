import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router'
import type { Dashboard, DepartmentStat, RequestStatus, Risk } from '../../api/types'
import { RequestStatusBadge, RiskBadge } from '../../components/badges'
import { Sheet } from '../../components/ui'
import { RISK_LABEL } from '../../lib/labels'

/** 왼쪽 기준선에서 자라는 얇은 막대. 수치는 옆에 글자로 함께 쓴다. */
function Bar({ value, max, className }: { value: number; max: number; className: string }) {
  const width = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="h-2.5 min-w-0 flex-1 border-l border-rule-strong" aria-hidden>
      {value > 0 && (
        <div
          className={`h-full rounded-r-[4px] ${className}`}
          style={{ width: `${width}%`, minWidth: 2 }}
        />
      )}
    </div>
  )
}

/** 요청 수와 승인 대기. 표지의 항목처럼 한 줄에 두고, 눌러서 목록으로 간다. */
export function SummaryRow({
  requestCount,
  pendingApprovalCount,
  requestsTo,
}: {
  requestCount: number
  pendingApprovalCount: number
  requestsTo: string
}) {
  const items = [
    { label: '요청', value: requestCount, to: requestsTo },
    { label: '승인 대기 중인 요청', value: pendingApprovalCount, to: '/approvals' },
  ]
  return (
    <div className="grid overflow-hidden rounded-md border border-rule bg-sheet sm:grid-cols-2">
      {items.map((item) => (
        <Link
          key={item.label}
          to={item.to}
          className="flex items-center gap-3 border-rule px-4 py-3 not-last:max-sm:border-b hover:bg-sheet-alt sm:not-last:border-r"
        >
          <span className="flex-1 text-sm text-ink-2">{item.label}</span>
          <span className="text-lg font-semibold tabular-nums">{item.value}건</span>
          <ChevronRight size={16} className="text-ink-3" aria-hidden />
        </Link>
      ))}
    </div>
  )
}

const STATUS_GROUPS: Array<{ label: string; statuses: RequestStatus[] }> = [
  {
    label: '진행 중',
    statuses: ['ANALYZING', 'REVIEWING', 'PENDING_APPROVAL', 'REAPPROVAL_REQUIRED', 'RUNNING', 'ROLLING_BACK'],
  },
  {
    label: '확인 필요',
    statuses: ['VERIFICATION_FAILED', 'ANALYSIS_FAILED', 'FAILED', 'ROLLBACK_FAILED', 'PARTIALLY_COMPLETED'],
  },
  {
    label: '끝남',
    statuses: ['COMPLETED', 'ROLLED_BACK', 'KILLED', 'REJECTED', 'CANCELED'],
  },
]

export function StatusCounts({
  counts,
  statusTo,
}: {
  counts: Dashboard['statusCounts']
  statusTo: (status: RequestStatus) => string
}) {
  const max = Math.max(0, ...Object.values(counts).map((value) => value ?? 0))
  const groups = STATUS_GROUPS.map((group) => ({
    label: group.label,
    statuses: group.statuses.filter((status) => (counts[status] ?? 0) > 0),
  })).filter((group) => group.statuses.length > 0)

  return (
    <Sheet title="상태별 건수">
      <div className="flex flex-col gap-4">
        {groups.map((group) => (
          <div key={group.label}>
            <h3 className="mb-1 text-[0.8125rem] font-medium text-ink-3">{group.label}</h3>
            <ul>
              {group.statuses.map((status) => {
                const value = counts[status] ?? 0
                return (
                  <li key={status}>
                    <Link
                      to={statusTo(status)}
                      className="-mx-2 grid grid-cols-[6.5rem_1fr_2.5rem] items-center gap-2 rounded px-2 py-1 hover:bg-sheet-alt"
                    >
                      <span>
                        <RequestStatusBadge status={status} />
                      </span>
                      <Bar value={value} max={max} className="bg-ink-3" />
                      <span className="text-right text-sm tabular-nums">{value}건</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </Sheet>
  )
}

const RISK_ORDER: Risk[] = ['LOW', 'MEDIUM', 'HIGH', 'FORBIDDEN']
const RISK_BAR: Record<Risk, string> = {
  LOW: 'bg-low',
  MEDIUM: 'bg-medium',
  HIGH: 'bg-high',
  FORBIDDEN: 'bg-forbidden',
}

export function RiskDistribution({ distribution }: { distribution: Dashboard['riskDistribution'] }) {
  const total = RISK_ORDER.reduce((sum, risk) => sum + distribution[risk], 0)
  const max = Math.max(...RISK_ORDER.map((risk) => distribution[risk]))
  return (
    <Sheet title="위험도 분포">
      {total === 0 ? (
        <p className="text-sm text-ink-3">아직 분석이 끝난 작업이 없습니다.</p>
      ) : (
        <>
          <p className="mb-3 text-[0.8125rem] text-ink-3">작업 {total}건 기준</p>
          <ul className="flex flex-col gap-2.5">
            {RISK_ORDER.map((risk) => {
              const value = distribution[risk]
              const share = Math.round((value / total) * 100)
              return (
                <li
                  key={risk}
                  title={`위험도 ${RISK_LABEL[risk]}: 작업 ${value}건 (${share}%)`}
                  className="grid grid-cols-[4.5rem_1fr_5.5rem] items-center gap-2"
                >
                  <span>
                    <RiskBadge risk={risk} />
                  </span>
                  <Bar value={value} max={max} className={RISK_BAR[risk]} />
                  <span className="text-right text-sm tabular-nums">
                    {value}건 <span className="text-ink-3">{share}%</span>
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </Sheet>
  )
}

const DEPARTMENT_MEASURES: Array<{ key: 'requests' | 'pendingApprovals' | 'running'; label: string }> = [
  { key: 'requests', label: '요청' },
  { key: 'pendingApprovals', label: '승인 대기' },
  { key: 'running', label: '실행 중' },
]

/** 부서별 비교. 항목마다 열을 나눠 색 대신 위치로 구분하고, 눈금은 세 열이 같다. */
export function DepartmentComparison({ departments }: { departments: DepartmentStat[] }) {
  const max = Math.max(
    0,
    ...departments.flatMap((department) => DEPARTMENT_MEASURES.map(({ key }) => department[key])),
  )
  return (
    <Sheet title="부서별 비교" flush>
      <div className="overflow-x-auto">
        <table className="sheet-table min-w-[36rem]">
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
                <th scope="row" className="border-b-rule text-sm text-ink">
                  {department.name}
                </th>
                {DEPARTMENT_MEASURES.map(({ key, label }) => (
                  <td key={key} title={`${department.name} ${label}: ${department[key]}건`}>
                    <div className="flex items-center gap-2">
                      <Bar value={department[key]} max={max} className="bg-seal" />
                      <span className="w-9 shrink-0 text-right tabular-nums">{department[key]}건</span>
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-2 text-xs text-ink-3">막대 길이는 세 열 모두 같은 눈금입니다.</p>
    </Sheet>
  )
}
