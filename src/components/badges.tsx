import {
  Ban,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleSlash,
  CircleX,
  Clock,
  Globe,
  Hourglass,
  Loader2,
  Network as NetworkIcon,
  OctagonX,
  PenLine,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  SkipForward,
  Undo2,
  type LucideIcon,
} from 'lucide-react'
import type { Network, RequestStatus, Risk, TaskStatus, TaskType } from '../api/types'
import {
  NETWORK_LABEL,
  REQUEST_STATUS_LABEL,
  RISK_EMOJI,
  RISK_LABEL,
  TASK_STATUS_LABEL,
  TASK_TYPE_LABEL,
} from '../lib/labels'

const PILL = 'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap'

const RISK_CLASS: Record<Risk, string> = {
  LOW: 'bg-low-soft text-low',
  MEDIUM: 'bg-medium-soft text-medium',
  HIGH: 'bg-high-soft text-high',
  FORBIDDEN: 'bg-forbidden-soft text-forbidden',
}

/** 위험도: 색 + 아이콘 + 글자 (색만으로 구분하지 않는다) */
export function RiskBadge({ risk }: { risk: Risk }) {
  return (
    <span className={`${PILL} ${RISK_CLASS[risk]}`}>
      <span aria-hidden className="text-[0.625rem] leading-none">
        {RISK_EMOJI[risk]}
      </span>
      {RISK_LABEL[risk]}
    </span>
  )
}

type Tone = 'neutral' | 'seal' | 'live' | 'amber' | 'red' | 'green'

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'bg-forbidden-soft text-forbidden',
  seal: 'bg-seal-soft text-seal-dark',
  live: 'bg-internal-soft text-internal',
  amber: 'bg-medium-soft text-medium',
  red: 'bg-high-soft text-high',
  green: 'bg-low-soft text-low',
}

const REQUEST_STATUS_STYLE: Record<RequestStatus, { tone: Tone; Icon: LucideIcon; spin?: boolean }> = {
  ANALYZING: { tone: 'live', Icon: Loader2, spin: true },
  ANALYSIS_FAILED: { tone: 'red', Icon: CircleX },
  REVIEWING: { tone: 'seal', Icon: PenLine },
  PENDING_APPROVAL: { tone: 'seal', Icon: Hourglass },
  REAPPROVAL_REQUIRED: { tone: 'amber', Icon: RefreshCw },
  VERIFICATION_FAILED: { tone: 'red', Icon: ShieldAlert },
  REJECTED: { tone: 'red', Icon: Ban },
  CANCELED: { tone: 'neutral', Icon: CircleSlash },
  RUNNING: { tone: 'live', Icon: Loader2, spin: true },
  KILLED: { tone: 'red', Icon: OctagonX },
  COMPLETED: { tone: 'green', Icon: CircleCheck },
  PARTIALLY_COMPLETED: { tone: 'amber', Icon: CircleDot },
  FAILED: { tone: 'red', Icon: CircleX },
  ROLLING_BACK: { tone: 'live', Icon: Loader2, spin: true },
  ROLLED_BACK: { tone: 'green', Icon: Undo2 },
  ROLLBACK_FAILED: { tone: 'red', Icon: RotateCcw },
}

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  const { tone, Icon, spin } = REQUEST_STATUS_STYLE[status]
  return (
    <span className={`${PILL} ${TONE_CLASS[tone]}`}>
      <Icon size={13} className={spin ? 'animate-spin' : ''} aria-hidden />
      {REQUEST_STATUS_LABEL[status]}
    </span>
  )
}

const TASK_STATUS_STYLE: Record<TaskStatus, { tone: Tone; Icon: LucideIcon; spin?: boolean }> = {
  PENDING: { tone: 'seal', Icon: Clock },
  APPROVED: { tone: 'green', Icon: CircleCheck },
  REJECTED: { tone: 'red', Icon: Ban },
  BLOCKED: { tone: 'neutral', Icon: CircleSlash },
  RUNNING: { tone: 'live', Icon: Loader2, spin: true },
  SUCCEEDED: { tone: 'green', Icon: CircleCheck },
  FAILED: { tone: 'red', Icon: CircleX },
  SKIPPED: { tone: 'neutral', Icon: SkipForward },
  ROLLED_BACK: { tone: 'green', Icon: Undo2 },
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const { tone, Icon, spin } = TASK_STATUS_STYLE[status]
  return (
    <span className={`${PILL} ${TONE_CLASS[tone]}`}>
      <Icon size={13} className={spin ? 'animate-spin' : ''} aria-hidden />
      {TASK_STATUS_LABEL[status]}
    </span>
  )
}

export function TaskTypeTag({ type }: { type: TaskType }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-rule px-1.5 py-0.5 text-xs whitespace-nowrap text-ink-2">
      <CircleDashed size={11} className="text-ink-3" aria-hidden />
      {TASK_TYPE_LABEL[type]}
    </span>
  )
}

export function NetworkBadge({ network }: { network: Network }) {
  const external = network === 'EXTERNAL'
  const Icon = external ? Globe : NetworkIcon
  return (
    <span className={`${PILL} ${external ? 'bg-external-soft text-external' : 'bg-internal-soft text-internal'}`}>
      <Icon size={13} aria-hidden />
      {NETWORK_LABEL[network]}
    </span>
  )
}
