import { CircleCheck, Hourglass, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useMe } from '../../app/AuthProvider'
import type { RequestDetail, RequestStatus, Task, TaskApprovalStatus } from '../../api/types'
import { ApprovalStamps, approvalSummary } from '../../components/ApprovalStamps'
import { LogViewer } from '../../components/LogViewer'
import { TaskCard } from '../../components/TaskCard'
import { Banner, Button, ErrorState, Mono, PageHeader, ReasonModal, Spinner } from '../../components/ui'
import { shortHash } from '../../lib/format'
import { FAILED_CHECK_LABEL } from '../../lib/labels'
import { useRequest } from '../../lib/queries'
import { AnalysisFailedPanel, CancelRequestButton, RequestMeta, TaskEditButtons } from './RequestParts'
import { RequestTimeline } from './RequestTimeline'
import { useKillRequest, useRetryFailed, useSubmitRequest } from './useRequestActions'

const CANCELABLE: RequestStatus[] = ['REVIEWING', 'PENDING_APPROVAL', 'REAPPROVAL_REQUIRED', 'VERIFICATION_FAILED']
const PLAN_EDITABLE: RequestStatus[] = ['PENDING_APPROVAL', 'PARTIALLY_COMPLETED']
const LIVE: RequestStatus[] = ['RUNNING', 'ROLLING_BACK']

function hasRecords(status: TaskApprovalStatus) {
  return status.requirements.some((requirement) => requirement.approvedBy.length > 0)
}

/** 작업별 승인 현황. 제출 전이나 승인을 받지 않고 끝난 작업에는 빈 결재란을 그리지 않는다. */
// TaskCard는 footer가 있으면 구분선을 긋기 때문에, 그릴 내용이 없을 때 null을 돌려주는 함수로 둔다.
function taskApprovalFooter(request: RequestDetail, task: Task) {
  const status = request.approvalStatus.find((item) => item.taskId === task.id)
  if (!status || request.status === 'REVIEWING') return null
  const waiting = request.status === 'PENDING_APPROVAL' || request.status === 'REAPPROVAL_REQUIRED'
  if (!hasRecords(status) && !(waiting && task.status === 'PENDING')) return null
  const allSigned = status.requirements.every((requirement) => requirement.satisfied)
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-1.5 text-[0.8125rem] font-medium">
        {allSigned ? (
          <CircleCheck size={15} className="shrink-0 text-low" aria-hidden />
        ) : (
          <Hourglass size={14} className="shrink-0 text-seal" aria-hidden />
        )}
        {task.id} {approvalSummary(status)}
      </p>
      <ApprovalStamps status={status} />
    </div>
  )
}

function KillSwitch({ requestId }: { requestId: string }) {
  const [open, setOpen] = useState(false)
  const kill = useKillRequest(requestId, () => setOpen(false))
  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
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

function StatusNotice({ request, isRequester }: { request: RequestDetail; isRequester: boolean }) {
  const navigate = useNavigate()
  const resubmit = useSubmitRequest(request.id)
  const retry = useRetryFailed(request.id)
  const changedCount = request.changedTaskIds.length

  switch (request.status) {
    case 'ANALYZING':
      return (
        <Banner tone="info" title="AI가 Plan을 분석하는 중입니다">
          <span className="inline-flex items-center gap-1.5">
            <Loader2 size={14} className="animate-spin" aria-hidden />
            끝나면 이 화면이 바로 바뀝니다.
          </span>
        </Banner>
      )
    case 'ANALYSIS_FAILED':
      return <AnalysisFailedPanel request={request} isRequester={isRequester} />
    case 'REVIEWING':
      return (
        <Banner
          tone="info"
          title={isRequester ? 'Plan을 확인하고 제출해 주세요' : '요청자가 Plan을 검토하는 중입니다'}
          action={
            isRequester && (
              <Button variant="primary" internalOnly onClick={() => navigate(`/requests/new/${request.id}`)}>
                Plan 검토
              </Button>
            )
          }
        >
          제출 전이라 아직 아무 승인도 없습니다.
        </Banner>
      )
    case 'PENDING_APPROVAL':
      return (
        <Banner
          tone="info"
          title={request.plan?.kind === 'ROLLBACK' ? '문서 롤백 승인을 기다립니다' : '승인권자의 승인을 기다립니다'}
          action={
            <Button variant="primary" onClick={() => navigate(`/approvals/${request.id}`)}>
              승인 상세
            </Button>
          }
        >
          필요한 승인이 모두 모이면 실행기가 서명과 해시를 다시 검증한 뒤 실행합니다.
        </Banner>
      )
    case 'REAPPROVAL_REQUIRED':
      return (
        <Banner
          tone="warning"
          title="Plan이 바뀌어 기존 승인 서명이 모두 무효가 되었습니다"
          action={
            isRequester && (
              <Button variant="primary" internalOnly loading={resubmit.isPending} onClick={() => resubmit.mutate()}>
                다시 제출
              </Button>
            )
          }
        >
          {changedCount > 0 && <p>바뀐 작업 {changedCount}개를 아래에 강조했습니다. 확인한 뒤 다시 제출해 주세요.</p>}
          {changedCount === 0 && <p>Plan을 확인한 뒤 다시 제출해 주세요.</p>}
          {request.removedTaskTitles.length > 0 && <p>삭제된 작업: {request.removedTaskTitles.join(', ')}</p>}
        </Banner>
      )
    case 'VERIFICATION_FAILED':
      return (
        <Banner
          tone="danger"
          title="실행기가 승인 서명 검증에 실패해 실행하지 않았습니다"
          action={
            isRequester && (
              <Button variant="primary" internalOnly loading={resubmit.isPending} onClick={() => resubmit.mutate()}>
                다시 제출
              </Button>
            )
          }
        >
          <p>위변조 가능성이 있어 관리자와 부서 관리자에게 경보를 보냈습니다. 다시 제출하면 승인 서명을 새로 받습니다.</p>
          <ul className="mt-2 flex flex-col gap-1">
            {request.failedChecks.map((check) => (
              <li key={check} className="flex flex-wrap items-baseline gap-x-2">
                <Mono className="font-medium">{check}</Mono>
                <span>{FAILED_CHECK_LABEL[check]}</span>
              </li>
            ))}
          </ul>
        </Banner>
      )
    case 'REJECTED':
      return (
        <Banner tone="danger" title={`${request.rejection?.by ?? '승인권자'} 님이 거부했습니다`}>
          {request.rejection?.reason}
        </Banner>
      )
    case 'KILLED':
      return (
        <Banner tone="danger" title={`${request.kill?.by ?? '사용자'} 님이 킬 스위치로 중단했습니다`}>
          <p>{request.kill?.reason}</p>
          {request.kill && request.kill.skippedTaskIds.length > 0 && (
            <p className="mt-1">실행하지 않은 작업: {request.kill.skippedTaskIds.join(', ')}</p>
          )}
        </Banner>
      )
    case 'PARTIALLY_COMPLETED':
      return (
        <Banner
          tone="warning"
          title="일부 작업만 성공했습니다"
          action={
            isRequester && (
              <Button variant="primary" internalOnly loading={retry.isPending} onClick={() => retry.mutate()}>
                실패 작업 재시도
              </Button>
            )
          }
        >
          승인 서명은 1회용이라 재시도하려면 새 서명이 필요합니다. 이미 성공한 코드 작업은 되돌리지 않습니다.
        </Banner>
      )
    case 'FAILED':
      return (
        <Banner tone="danger" title="성공한 작업 없이 실행이 끝났습니다">
          실행 로그에서 원인을 확인한 뒤 새로 요청해 주세요.
        </Banner>
      )
    case 'ROLLBACK_FAILED':
      return (
        <Banner tone="danger" title="문서 롤백에 실패했습니다">
          관리자와 담당자에게 경보를 보냈습니다. 문서 화면에서 다시 롤백을 요청할 수 있으며, 새 서명이 필요합니다.
        </Banner>
      )
    default:
      return null
  }
}

export default function RequestDetailPage() {
  const { requestId } = useParams()
  const me = useMe()
  const navigate = useNavigate()
  const query = useRequest(requestId)

  if (query.isPending) return <Spinner />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  const request = query.data

  const isRequester = request.requester.id === me.id
  const hasSigned = request.approvalStatus.some((status) =>
    status.requirements.some((requirement) => requirement.approvedBy.some((record) => record.userId === me.id)),
  )
  // 부서 범위는 서버가 다시 판단한다. 직원은 본인 요청이나 본인이 승인한 작업만 멈출 수 있다 (3.2).
  const canKill = request.status === 'RUNNING' && (me.role !== 'EMPLOYEE' || isRequester || hasSigned)
  const canEditPlan = isRequester && PLAN_EDITABLE.includes(request.status)
  const hasRun = request.events.some((event) => event.status === 'RUNNING' || event.status === 'ROLLING_BACK')
  const tasks = request.plan?.tasks ?? []

  return (
    <>
      <PageHeader
        title={request.prompt}
        meta={
          <>
            <RequestMeta request={request} />
            {request.plan?.kind === 'ROLLBACK' && (
              <span className="rounded bg-seal-soft px-1.5 py-0.5 text-xs font-medium text-seal-dark">문서 롤백 Plan</span>
            )}
          </>
        }
        actions={
          <>
            {canKill && <KillSwitch requestId={request.id} />}
            {isRequester && CANCELABLE.includes(request.status) && (
              <CancelRequestButton requestId={request.id} onDone={() => navigate('/requests')} />
            )}
          </>
        }
      />

      <RequestTimeline request={request} />

      <div className="mb-5 empty:hidden">
        <StatusNotice request={request} isRequester={isRequester} />
      </div>

      {tasks.length > 0 && (
        <section className="mb-5">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[0.9375rem]">작업과 승인 현황</h2>
            {request.plan?.planHash && (
              <p className="text-xs text-ink-3">
                Plan 해시 <Mono className="text-xs">{shortHash(request.plan.planHash)}</Mono>
              </p>
            )}
          </div>
          <div className="flex flex-col gap-3">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                requestId={request.id}
                highlighted={request.status === 'REAPPROVAL_REQUIRED' && request.changedTaskIds.includes(task.id)}
                actions={
                  canEditPlan && task.status !== 'SUCCEEDED' ? (
                    <TaskEditButtons task={task} request={request} voidsApprovals />
                  ) : undefined
                }
                footer={taskApprovalFooter(request, task)}
              />
            ))}
          </div>
        </section>
      )}

      {hasRun && (
        <section>
          <h2 className="mb-2 text-[0.9375rem]">실행 로그</h2>
          <LogViewer requestId={request.id} live={LIVE.includes(request.status)} />
        </section>
      )}
    </>
  )
}
