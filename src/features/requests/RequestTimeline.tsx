import type { RequestDetail, RequestStatus } from '../../api/types'
import { Stepper, type Step } from '../../components/RequestStepper'
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

  const steps: Step[] = STAGES.map((stage, index) => {
    const isCurrent = index === current
    const at =
      index <= current
        ? [...request.events].reverse().find((event) => STAGE_EVENTS[index].includes(event.status))?.at
        : undefined
    return {
      key: stage,
      label: stage,
      state: isCurrent && stopped ? 'error' : index < current || (isCurrent && finished) ? 'done' : isCurrent ? 'current' : 'todo',
      hint: (
        <>
          {isCurrent && (
            <span className={`block font-medium ${stopped ? 'text-high' : 'text-ink-2'}`}>
              {REQUEST_STATUS_LABEL[request.status]}
            </span>
          )}
          {at && <span className="block">{formatDateTime(at)}</span>}
        </>
      ),
    }
  })

  return (
    <section aria-label="요청 진행 단계" className="rounded-xl border border-rule bg-sheet px-4 py-3 shadow-card">
      <Stepper steps={steps} />
    </section>
  )
}
