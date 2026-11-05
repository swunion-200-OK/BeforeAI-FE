import type { ReactNode } from 'react'
import type { Network, RequestStatus, Risk, TaskStatus } from '../api/types'
import { NETWORK_LABEL, REQUEST_STATUS_LABEL, RISK_LABEL, TASK_STATUS_LABEL } from '../lib/labels'

/**
 * 상태는 작은 모양 하나와 색 있는 낱말로 쓴다. 바탕을 칠하지 않는다.
 * 모양은 다섯 가지뿐이다: 끝남(done), 실패(fail), 기다림(wait), 진행(run), 멈춤(stop).
 */
export type StatusShape = 'done' | 'fail' | 'wait' | 'run' | 'stop'

/** 글자색(currentColor)을 따라가는 상태 모양. 낱말과 함께 쓰므로 스크린 리더에는 숨긴다. */
export function StatusGlyph({ shape, size = 14, className = '' }: { shape: StatusShape; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden
      className={`shrink-0 ${shape === 'run' ? 'animate-spin' : ''} ${className}`}
    >
      {shape === 'done' && (
        <>
          <circle cx="8" cy="8" r="7.5" fill="currentColor" />
          <path d="M4.6 8.3 7 10.7l4.4-4.9" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {shape === 'fail' && (
        <>
          <circle cx="8" cy="8" r="7.5" fill="currentColor" />
          <path d="m5.3 5.3 5.4 5.4m0-5.4-5.4 5.4" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
        </>
      )}
      {shape === 'stop' && (
        <>
          <circle cx="8" cy="8" r="7.5" fill="currentColor" />
          <path d="M4.8 8h6.4" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
        </>
      )}
      {shape === 'wait' && (
        <>
          <circle cx="8" cy="8" r="6.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 4.6V8l2.3 1.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {shape === 'run' && (
        <>
          <circle cx="8" cy="8" r="6.75" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
          <path d="M8 1.25A6.75 6.75 0 0 1 14.75 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </>
      )}
    </svg>
  )
}

export type StatusTone = 'neutral' | 'muted' | 'seal' | 'amber' | 'red' | 'green'

const TONE_CLASS: Record<StatusTone, string> = {
  neutral: 'text-ink-2',
  muted: 'text-ink-3',
  seal: 'text-seal',
  amber: 'text-medium',
  red: 'text-high',
  green: 'text-low',
}

const STATUS_TEXT = 'inline-flex items-center gap-1.5 text-[0.875rem] leading-5 font-medium whitespace-nowrap'

/** 모양 + 낱말. 화면에서 직접 만든 상태 표시("바뀐 작업" 등)도 이것을 쓴다. */
export function StatusText({ shape, tone, children }: { shape: StatusShape; tone: StatusTone; children: ReactNode }) {
  return (
    <span className={`${STATUS_TEXT} ${TONE_CLASS[tone]}`}>
      <StatusGlyph shape={shape} />
      {children}
    </span>
  )
}

const RISK_STYLE: Record<Risk, { word: string; dot: string }> = {
  LOW: { word: 'font-normal text-ink-2', dot: 'rounded-full bg-low' },
  MEDIUM: { word: 'font-medium text-medium', dot: 'rounded-full bg-medium' },
  HIGH: { word: 'font-semibold text-high', dot: 'rounded-full bg-high' },
  FORBIDDEN: { word: 'font-semibold text-forbidden', dot: 'bg-forbidden' },
}

/** 위험도: 점 + 낱말. 금지만 네모 점이라 색 없이도 구분된다. 승인 판단 정보이므로 낮음도 숨기지 않는다. */
export function RiskBadge({ risk }: { risk: Risk }) {
  const { word, dot } = RISK_STYLE[risk]
  return (
    <span className={`inline-flex items-center gap-1.5 text-[0.875rem] leading-5 whitespace-nowrap ${word}`}>
      <span aria-hidden className={`size-2 shrink-0 ${dot}`} />
      {RISK_LABEL[risk]}
    </span>
  )
}

const REQUEST_STATUS_STYLE: Record<RequestStatus, { tone: StatusTone; shape: StatusShape }> = {
  ANALYZING: { tone: 'neutral', shape: 'run' },
  ANALYSIS_FAILED: { tone: 'red', shape: 'fail' },
  REVIEWING: { tone: 'neutral', shape: 'wait' },
  PENDING_APPROVAL: { tone: 'neutral', shape: 'wait' },
  REAPPROVAL_REQUIRED: { tone: 'amber', shape: 'wait' },
  VERIFICATION_FAILED: { tone: 'red', shape: 'fail' },
  REJECTED: { tone: 'red', shape: 'fail' },
  CANCELED: { tone: 'muted', shape: 'stop' },
  RUNNING: { tone: 'amber', shape: 'run' },
  KILLED: { tone: 'red', shape: 'stop' },
  COMPLETED: { tone: 'green', shape: 'done' },
  PARTIALLY_COMPLETED: { tone: 'amber', shape: 'stop' },
  FAILED: { tone: 'red', shape: 'fail' },
  ROLLING_BACK: { tone: 'amber', shape: 'run' },
  ROLLED_BACK: { tone: 'neutral', shape: 'done' },
  ROLLBACK_FAILED: { tone: 'red', shape: 'fail' },
}

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  const { tone, shape } = REQUEST_STATUS_STYLE[status]
  return (
    <StatusText tone={tone} shape={shape}>
      {REQUEST_STATUS_LABEL[status]}
    </StatusText>
  )
}

/** 트리의 상태 색과 뜻을 맞춘다: 대기 회색, 승인됨 파랑, 실행 중 노랑, 성공 초록, 실패 빨강. */
const TASK_STATUS_STYLE: Record<TaskStatus, { tone: StatusTone; shape: StatusShape }> = {
  PENDING: { tone: 'neutral', shape: 'wait' },
  APPROVED: { tone: 'seal', shape: 'done' },
  REJECTED: { tone: 'red', shape: 'fail' },
  BLOCKED: { tone: 'neutral', shape: 'stop' },
  RUNNING: { tone: 'amber', shape: 'run' },
  SUCCEEDED: { tone: 'green', shape: 'done' },
  FAILED: { tone: 'red', shape: 'fail' },
  SKIPPED: { tone: 'muted', shape: 'stop' },
  ROLLED_BACK: { tone: 'neutral', shape: 'done' },
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const { tone, shape } = TASK_STATUS_STYLE[status]
  return (
    <StatusText tone={tone} shape={shape}>
      {TASK_STATUS_LABEL[status]}
    </StatusText>
  )
}

/** 접속망은 그냥 글자로 쓴다. 외부망만 기능이 줄어드니 색을 준다. */
export function NetworkBadge({ network }: { network: Network }) {
  return (
    <span className={`text-[0.875rem] leading-5 whitespace-nowrap ${network === 'EXTERNAL' ? 'font-semibold text-external' : 'text-ink-3'}`}>
      {NETWORK_LABEL[network]}
    </span>
  )
}
