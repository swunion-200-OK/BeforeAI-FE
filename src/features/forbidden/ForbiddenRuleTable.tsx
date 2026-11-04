import type { ReactNode } from 'react'
import type { ForbiddenRule } from '../../api/types'
import { TaskTypeTag } from '../../components/badges'
import { EmptyState, Mono } from '../../components/ui'
import { formatDateTime } from '../../lib/format'

export const RELEASE_PENDING_NOTICE = '실행기 로컬 콘솔에서 관리자 재확인 후 실제 해제됩니다'

function RuleStatus({ rule }: { rule: ForbiddenRule }) {
  if (rule.status === 'ACTIVE') {
    return <span className="rounded bg-forbidden-soft px-1.5 py-0.5 text-xs font-medium text-forbidden">🔒 적용 중</span>
  }
  return (
    <div>
      <span className="rounded bg-medium-soft px-1.5 py-0.5 text-xs font-medium text-medium">해제 대기</span>
      <p className="mt-1 max-w-56 text-xs text-ink-3">{RELEASE_PENDING_NOTICE}</p>
    </div>
  )
}

/** 확정된 금지 규칙 표. 관리자는 renderAction으로 해제 버튼을 넣는다. */
export function ForbiddenRuleTable({
  rules,
  renderAction,
}: {
  rules: ForbiddenRule[]
  renderAction?: (rule: ForbiddenRule) => ReactNode
}) {
  if (rules.length === 0) {
    return <EmptyState title="확정된 금지 규칙이 없습니다" />
  }
  return (
    <div className="overflow-x-auto">
      <table className="sheet-table">
        <thead>
          <tr>
            <th>작업 유형</th>
            <th>대상</th>
            <th>사유</th>
            <th>상태</th>
            <th>확정 시각</th>
            {renderAction && <th aria-label="동작" />}
          </tr>
        </thead>
        <tbody>
          {rules.map((rule) => (
            <tr key={rule.id}>
              <td>
                <TaskTypeTag type={rule.taskType} />
              </td>
              <td>
                <Mono>{rule.target}</Mono>
              </td>
              <td className="min-w-48">{rule.reason}</td>
              <td>
                <RuleStatus rule={rule} />
              </td>
              <td className="whitespace-nowrap text-ink-2">{formatDateTime(rule.createdAt)}</td>
              {renderAction && <td className="text-right">{renderAction(rule)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
