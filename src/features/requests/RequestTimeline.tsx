import { Check, X } from 'lucide-react'
import type { RequestDetail, RequestStatus } from '../../api/types'
import { formatDateTime } from '../../lib/format'
import { REQUEST_STATUS_LABEL } from '../../lib/labels'

const STAGES = ['분석', '검토', '제출', '승인', '실행', '결과'] as const

const STAGE_OF: Record<Exclude<RequestStatus, 'CANCELED'>, number> = {
  ANALYZING: 0,
  ANALYSIS_FAILED: 0,
  REVIEWING: 1,
  REAPPROVAL_REQUIRED: 2,
  PENDING_APPROVAL: 3,
  VERIFICATION_FAILED: 3,
  REJECTED: 3,
  RUNNING: 4,
  ROLLING_BACK: 4,
  KILLED: 5,
  COMPLETED: 5,
  PARTIALLY_COMPLETED: 5,
  FAILED: 5,
  ROLLED_BACK: 5,
  ROLLBACK_FAILED: 5,
}

const STOPPED: RequestStatus[] = [
  'ANALYSIS_FAILED',
  'VERIFICATION_FAILED',
  'REJECTED',
  'CANCELED',
  'KILLED',
  'FAILED',
  'ROLLBACK_FAILED',
]
const FINISHED: RequestStatus[] = ['COMPLETED', 'ROLLED_BACK']

/** 단계마다 그 단계가 끝난 시각으로 쓸 이벤트 */
const STAGE_EVENTS: RequestStatus[][] = [
  ['ANALYZING'],
  ['REVIEWING'],
  ['PENDING_APPROVAL'],
  ['RUNNING', 'ROLLING_BACK', 'VERIFICATION_FAILED', 'REJECTED'],
  ['RUNNING', 'ROLLING_BACK'],
  ['KILLED', 'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'ROLLED_BACK', 'ROLLBACK_FAILED'],
]

function currentStage(request: RequestDetail): number {
  if (request.status !== 'CANCELED') return STAGE_OF[request.status]
  // 취소는 취소하기 직전 단계에 표시한다.
  const before = [...request.events].reverse().find((event) => event.status !== 'CANCELED')
  return before && before.status !== 'CANCELED' ? STAGE_OF[before.status] : 0
}

/** 상태 타임라인: 분석 → 검토 → 제출 → 승인 → 실행 → 결과 */
export function RequestTimeline({ request }: { request: RequestDetail }) {
  const current = currentStage(request)
  const stopped = STOPPED.includes(request.status)
  const finished = FINISHED.includes(request.status)
  const partial = request.status === 'PARTIALLY_COMPLETED'

  return (
    <ol className="mb-5 grid grid-cols-6 overflow-x-auto rounded-md border border-rule bg-sheet px-2 py-3" aria-label="요청 진행 단계">
      {STAGES.map((stage, index) => {
        const isCurrent = index === current
        const done = index < current || (isCurrent && finished)
        const failed = isCurrent && stopped
        const at =
          index <= current
            ? [...request.events].reverse().find((event) => STAGE_EVENTS[index].includes(event.status))?.at
            : undefined
        const marker = failed
          ? 'border-high bg-high text-white'
          : done
            ? 'border-seal bg-seal text-white'
            : isCurrent
              ? partial
                ? 'border-medium bg-medium-soft text-medium'
                : 'border-seal bg-seal-soft text-seal'
              : 'border-rule-strong bg-sheet text-ink-3'
        return (
          <li key={stage} className="relative min-w-20 px-1 text-center" aria-current={isCurrent ? 'step' : undefined}>
            {index > 0 && (
              <span
                aria-hidden
                className={`absolute top-3 right-1/2 h-px w-full ${index <= current ? 'bg-seal' : 'bg-rule-strong'}`}
              />
            )}
            <span
              className={`relative mx-auto flex size-6 items-center justify-center rounded-full border-2 text-xs font-semibold ${marker}`}
            >
              {failed ? <X size={13} aria-hidden /> : done ? <Check size={13} aria-hidden /> : index + 1}
            </span>
            <p className={`mt-1 text-[0.8125rem] ${isCurrent ? 'font-semibold text-ink' : index < current ? 'text-ink-2' : 'text-ink-3'}`}>
              {stage}
            </p>
            {isCurrent && <p className={`text-xs ${failed ? 'text-high' : 'text-ink-2'}`}>{REQUEST_STATUS_LABEL[request.status]}</p>}
            {at && <p className="text-2xs text-ink-3">{formatDateTime(at)}</p>}
          </li>
        )
      })}
    </ol>
  )
}
