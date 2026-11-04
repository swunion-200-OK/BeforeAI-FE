import { CircleCheck, Hourglass, ListTree, Stamp, Zap } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import type { RequestDetail, RequestStatus, Task, TaskApprovalStatus } from '../../api/types'
import { ApprovalStamps, approvalSummary } from '../../components/ApprovalStamps'
import { KeyValues, Timeline } from '../../components/rich'
import { Button, Mono, ReasonModal, Sheet } from '../../components/ui'
import { formatDateTime, shortHash } from '../../lib/format'
import { REQUEST_STATUS_LABEL, SOURCE_LABEL } from '../../lib/labels'
import { CancelRequestButton } from './RequestParts'
import { useKillRequest, useRetryFailed, useSubmitRequest } from './useRequestActions'

const CANCELABLE: RequestStatus[] = ['REVIEWING', 'PENDING_APPROVAL', 'REAPPROVAL_REQUIRED', 'VERIFICATION_FAILED']
const IN_PROGRESS: RequestStatus[] = [
  'ANALYZING',
  'REVIEWING',
  'PENDING_APPROVAL',
  'REAPPROVAL_REQUIRED',
  'RUNNING',
  'ROLLING_BACK',
]
const ERROR_END: RequestStatus[] = [
  'ANALYSIS_FAILED',
  'VERIFICATION_FAILED',
  'REJECTED',
  'KILLED',
  'FAILED',
  'ROLLBACK_FAILED',
]

function KillSwitch({ requestId }: { requestId: string }) {
  const [open, setOpen] = useState(false)
  const kill = useKillRequest(requestId, () => setOpen(false))
  return (
    <>
      <Button variant="danger" size="lg" className="w-full" onClick={() => setOpen(true)}>
        <Zap size={16} aria-hidden />
        킬 스위치
      </Button>
      <ReasonModal
        open={open}
        title="실행을 바로 중단할까요?"
        description="이미 끝난 작업은 되돌리지 않고, 남은 작업은 실행하지 않습니다."
        placeholder="잘못된 브랜치에 배포 중"
        confirmLabel="실행 중단"
        loading={kill.isPending}
        onClose={() => setOpen(false)}
        onConfirm={(reason) => kill.mutate(reason)}
      />
    </>
  )
}

/** 지금 이 사람이 할 수 있는 다음 행동. 할 일이 없으면 칸을 그리지 않는다. */
function NextActions({
  request,
  isRequester,
  canKill,
}: {
  request: RequestDetail
  isRequester: boolean
  canKill: boolean
}) {
  const navigate = useNavigate()
  const resubmit = useSubmitRequest(request.id)
  const retry = useRetryFailed(request.id)
  const { status } = request

  const actions: ReactNode[] = []
  if (canKill) actions.push(<KillSwitch key="kill" requestId={request.id} />)
  if (status === 'REVIEWING' && isRequester) {
    actions.push(
      <Button key="review" variant="primary" size="lg" className="w-full" internalOnly onClick={() => navigate(`/requests/new/${request.id}`)}>
        Plan 검토
      </Button>,
    )
  }
  if (status === 'PENDING_APPROVAL') {
    actions.push(
      <Button key="approval" variant="primary" size="lg" className="w-full" onClick={() => navigate(`/approvals/${request.id}`)}>
        승인 상세
      </Button>,
    )
  }
  if ((status === 'REAPPROVAL_REQUIRED' || status === 'VERIFICATION_FAILED') && isRequester) {
    actions.push(
      <Button
        key="resubmit"
        variant="primary"
        size="lg"
        className="w-full"
        internalOnly
        loading={resubmit.isPending}
        onClick={() => resubmit.mutate()}
      >
        다시 제출
      </Button>,
    )
  }
  if (status === 'PARTIALLY_COMPLETED' && isRequester) {
    actions.push(
      <Button
        key="retry"
        variant="primary"
        size="lg"
        className="w-full"
        internalOnly
        loading={retry.isPending}
        onClick={() => retry.mutate()}
      >
        실패 작업 재시도
      </Button>,
    )
  }
  if (isRequester && CANCELABLE.includes(status)) {
    actions.push(<CancelRequestButton key="cancel" requestId={request.id} fullWidth onDone={() => navigate('/requests')} />)
  }
  if (actions.length === 0) return null

  return (
    <Sheet>
      <div className="flex flex-col gap-2 [&>*]:w-full">{actions}</div>
    </Sheet>
  )
}

function hasRecords(status: TaskApprovalStatus) {
  return status.requirements.some((requirement) => requirement.approvedBy.length > 0)
}

/** 제출 전이나 승인을 받지 않고 끝난 작업에는 빈 결재란을 그리지 않는다. */
function shouldDrawStamps(request: RequestDetail, task: Task, status: TaskApprovalStatus | undefined) {
  if (!status || request.status === 'REVIEWING') return false
  const waiting = request.status === 'PENDING_APPROVAL' || request.status === 'REAPPROVAL_REQUIRED'
  return hasRecords(status) || (waiting && task.status === 'PENDING')
}

function ApprovalBoard({ request }: { request: RequestDetail }) {
  const rows = (request.plan?.tasks ?? []).flatMap((task) => {
    const status = request.approvalStatus.find((item) => item.taskId === task.id)
    return status && shouldDrawStamps(request, task, status) ? [{ task, status }] : []
  })
  if (rows.length === 0) return null
  return (
    <Sheet title="결재 현황" icon={<Stamp size={15} aria-hidden />}>
      {/* 칸이 하나인 결재란은 둘씩 나란히 놓아 패널 길이를 줄인다 */}
      <ul className="grid grid-cols-2 gap-x-3 gap-y-3.5">
        {rows.map(({ task, status }) => {
          const allSigned = status.requirements.every((requirement) => requirement.satisfied)
          return (
            <li key={task.id} className={status.requirements.length > 1 ? 'col-span-2 min-w-0' : 'min-w-0'}>
              <p className="flex items-start gap-1.5 text-[0.8125rem] font-medium">
                {allSigned ? (
                  <CircleCheck size={15} className="mt-0.5 shrink-0 text-low" aria-hidden />
                ) : (
                  <Hourglass size={14} className="mt-0.5 shrink-0 text-seal" aria-hidden />
                )}
                <span>
                  {task.id} {approvalSummary(status)}
                </span>
              </p>
              <div className="mt-1.5 overflow-x-auto">
                <ApprovalStamps status={status} />
              </div>
            </li>
          )
        })}
      </ul>
    </Sheet>
  )
}

function PlanSummary({ request }: { request: RequestDetail }) {
  const { plan } = request
  if (!plan) return null
  return (
    <Sheet title="Plan 정보" icon={<ListTree size={15} aria-hidden />}>
      <KeyValues
        items={[
          { label: 'Plan 해시', value: <Mono>{plan.planHash ? shortHash(plan.planHash) : '제출 후 만들어집니다'}</Mono> },
          { label: '기준 커밋', value: <Mono>{plan.baseCommit}</Mono> },
          { label: '저장소', value: <Mono>{plan.repository}</Mono> },
          { label: '출처', value: SOURCE_LABEL[request.source] },
        ]}
      />
    </Sheet>
  )
}

function History({ request }: { request: RequestDetail }) {
  const last = request.events.length - 1
  return (
    <Sheet title="진행 기록">
      <Timeline
        items={request.events.map((event, index) => ({
          key: `${event.status}-${event.at}`,
          title: REQUEST_STATUS_LABEL[event.status],
          meta: `${event.by ? `${event.by}, ` : ''}${formatDateTime(event.at)}`,
          tone:
            index < last
              ? 'done'
              : ERROR_END.includes(event.status)
                ? 'error'
                : IN_PROGRESS.includes(event.status)
                  ? 'current'
                  : 'done',
        }))}
      />
    </Sheet>
  )
}

/** 요청 상세 오른쪽 패널: 다음 할 일, 결재 현황, Plan 정보, 진행 기록 */
export function RequestDetailRail({
  request,
  isRequester,
  canKill,
}: {
  request: RequestDetail
  isRequester: boolean
  canKill: boolean
}) {
  return (
    <aside aria-label="요청 요약" className="sticky top-4 flex flex-col gap-3">
      <NextActions request={request} isRequester={isRequester} canKill={canKill} />
      <ApprovalBoard request={request} />
      <PlanSummary request={request} />
      <History request={request} />
    </aside>
  )
}
