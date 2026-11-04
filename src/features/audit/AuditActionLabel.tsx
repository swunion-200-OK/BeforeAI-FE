import type { AuditAction } from '../../api/types'
import { AUDIT_ACTION_LABEL } from '../../lib/labels'
import { isDangerAction } from './auditFilters'

/** 감사 로그 액션. 위험한 액션만 색을 넣어 훑어볼 때 먼저 보이게 한다. */
export function AuditActionLabel({ action }: { action: AuditAction }) {
  return (
    <span className={`whitespace-nowrap ${isDangerAction(action) ? 'font-medium text-high' : 'text-ink'}`}>
      {AUDIT_ACTION_LABEL[action] ?? action}
    </span>
  )
}
