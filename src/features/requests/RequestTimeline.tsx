import type { RequestDetail, RequestStatus } from '../../api/types'
import { Stepper, type Step } from '../../components/RequestStepper'

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
    return {
      key: stage,
      label: stage,
      state: isCurrent && stopped ? 'error' : index < current || (isCurrent && finished) ? 'done' : isCurrent ? 'current' : 'todo',
    }
  })

  return (
    <section aria-label="요청 진행 단계">
      <Stepper steps={steps} />
    </section>
  )
}
