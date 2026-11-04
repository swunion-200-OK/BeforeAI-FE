import {
  Ban,
  BookText,
  CircleCheck,
  CircleSlash,
  CircleX,
  FileClock,
  FilePlus2,
  KeyRound,
  LogIn,
  OctagonX,
  PencilLine,
  Play,
  RotateCcw,
  Send,
  Settings2,
  ShieldAlert,
  ShieldBan,
  Stamp,
  Undo2,
  UserCog,
  type LucideIcon,
} from 'lucide-react'
import type { AuditAction } from '../../api/types'
import { AUDIT_ACTION_LABEL } from '../../lib/labels'
import { isDangerAction } from './auditFilters'

type Tone = 'danger' | 'success' | 'seal' | 'live' | 'amber' | 'neutral'

const TONE: Record<Tone, { box: string; text: string }> = {
  danger: { box: 'bg-high-soft text-high', text: 'font-semibold text-high' },
  success: { box: 'bg-low-soft text-low', text: 'text-ink' },
  seal: { box: 'bg-seal-soft text-seal', text: 'text-ink' },
  live: { box: 'bg-internal-soft text-internal', text: 'text-ink' },
  amber: { box: 'bg-medium-soft text-medium', text: 'text-ink' },
  neutral: { box: 'bg-paper text-ink-2', text: 'text-ink' },
}

const ACTION_STYLE: Record<AuditAction, { icon: LucideIcon; tone: Tone }> = {
  REQUEST_CREATED: { icon: FilePlus2, tone: 'neutral' },
  PLAN_UPDATED: { icon: PencilLine, tone: 'neutral' },
  SUBMITTED: { icon: Send, tone: 'seal' },
  APPROVAL_SUBMITTED: { icon: Stamp, tone: 'seal' },
  REJECTED: { icon: Ban, tone: 'danger' },
  REQUEST_CANCELED: { icon: CircleSlash, tone: 'neutral' },
  EXECUTION_STARTED: { icon: Play, tone: 'live' },
  VERIFICATION_FAILED: { icon: ShieldAlert, tone: 'danger' },
  TASK_SUCCEEDED: { icon: CircleCheck, tone: 'success' },
  TASK_FAILED: { icon: CircleX, tone: 'danger' },
  KILLED: { icon: OctagonX, tone: 'danger' },
  ROLLBACK_REQUESTED: { icon: Undo2, tone: 'amber' },
  ROLLBACK_SUCCEEDED: { icon: Undo2, tone: 'success' },
  ROLLBACK_FAILED: { icon: RotateCcw, tone: 'danger' },
  SPEC_UPDATED: { icon: BookText, tone: 'neutral' },
  FORBIDDEN_RULE_PROPOSED: { icon: ShieldBan, tone: 'amber' },
  FORBIDDEN_RULE_CONFIRMED: { icon: ShieldBan, tone: 'amber' },
  FORBIDDEN_RULE_REJECTED: { icon: ShieldBan, tone: 'neutral' },
  FORBIDDEN_RULE_RELEASE_REQUESTED: { icon: ShieldBan, tone: 'amber' },
  KEY_SUBMITTED: { icon: KeyRound, tone: 'neutral' },
  KEY_REGISTERED: { icon: KeyRound, tone: 'success' },
  KEY_REVOKED: { icon: KeyRound, tone: 'amber' },
  LOGIN: { icon: LogIn, tone: 'neutral' },
  ACCOUNT_CHANGED: { icon: UserCog, tone: 'neutral' },
  POLICY_CHANGED: { icon: Settings2, tone: 'amber' },
}

/** 감사 로그 액션: 아이콘 + 색 + 글자. 위험한 액션은 굵게 표시해 훑어볼 때 먼저 보이게 한다. */
export function AuditActionLabel({ action }: { action: AuditAction }) {
  const style = ACTION_STYLE[action] ?? { icon: FileClock, tone: 'neutral' as const }
  const { icon: Icon } = style
  const tone = TONE[isDangerAction(action) ? 'danger' : style.tone]
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={`inline-flex size-5 shrink-0 items-center justify-center rounded ${tone.box}`}>
        <Icon size={13} aria-hidden />
      </span>
      <span className={tone.text}>{AUDIT_ACTION_LABEL[action] ?? action}</span>
    </span>
  )
}
