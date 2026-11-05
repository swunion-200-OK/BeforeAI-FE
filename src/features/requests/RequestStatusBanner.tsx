import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import type { RequestDetail, RequestStatus } from '../../api/types'
import { approvalSummary } from '../../components/ApprovalStamps'
import { Banner, Button, Mono, ReasonModal } from '../../components/ui'
import { approvalToShow } from './requestPaths'
import { AnalysisFailedPanel, CancelRequestButton } from './RequestParts'
import { useKillRequest, useRetryFailed, useSubmitRequest } from './useRequestActions'

const CANCELABLE: RequestStatus[] = ['REVIEWING', 'PENDING_APPROVAL', 'REAPPROVAL_REQUIRED', 'VERIFICATION_FAILED']

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

/** 아직 승인이 덜 모인 작업과 그 작업이 누구를 기다리는지. */
function waitingRows(request: RequestDetail) {
  return (request.plan?.tasks ?? []).flatMap((task) => {
    const status = approvalToShow(request, task)
    if (!status || status.requirements.every((item) => item.satisfied)) return []
    return [{ id: task.id, title: task.title, text: approvalSummary(status) }]
  })
}

function WaitingFor({ rows }: { rows: ReturnType<typeof waitingRows> }) {
  return (
    <ul className="mt-2 mb-1 flex flex-col gap-1.5 text-base text-ink">
      {rows.map((row) => (
        <li key={row.id}>
          <span className="font-semibold">{row.title}</span>
          <span className="ml-2 text-ink-2">{row.text}</span>
        </li>
      ))}
    </ul>
  )
}

/** 지금 이 사람이 할 수 있는 다음 행동. 주된 버튼 하나와, 요청자에게만 보이는 취소. */
function NextActions({ request, isRequester, canKill }: { request: RequestDetail; isRequester: boolean; canKill: boolean }) {
  const navigate = useNavigate()
  const resubmit = useSubmitRequest(request)
  const retry = useRetryFailed(request)
  const { status } = request

  const actions: ReactNode[] = []
  if (isRequester && CANCELABLE.includes(status)) {
    actions.push(<CancelRequestButton key="cancel" requestId={request.id} onDone={() => navigate('/requests')} />)
  }
  if (canKill) actions.push(<KillSwitch key="kill" requestId={request.id} />)
  if (status === 'REVIEWING' && isRequester) {
    actions.push(
      <Button key="review" variant="primary" internalOnly onClick={() => navigate(`/requests/new/${request.id}`)}>
        Plan 검토
      </Button>,
    )
  }
  if (status === 'PENDING_APPROVAL') {
    actions.push(
      <Button key="approval" variant="primary" onClick={() => navigate(`/approvals/${request.id}`)}>
        승인 상세
      </Button>,
    )
  }
  if ((status === 'REAPPROVAL_REQUIRED' || status === 'VERIFICATION_FAILED') && isRequester) {
    actions.push(
      <Button key="resubmit" variant="primary" internalOnly loading={resubmit.isPending} onClick={() => resubmit.mutate()}>
        다시 제출
      </Button>,
    )
  }
  if (status === 'PARTIALLY_COMPLETED' && isRequester) {
    actions.push(
      <Button key="retry" variant="primary" internalOnly loading={retry.isPending} onClick={() => retry.mutate()}>
        실패 작업 재시도
      </Button>,
    )
  }
  if (actions.length === 0) return null
  return <div className="flex items-center gap-2">{actions}</div>
}

/** 지금 상태가 무슨 뜻인지와 다음 할 일을 한 칸에 모은다. 평범하게 끝난 요청에는 그리지 않는다. */
export function RequestStatusBanner({
  request,
  isRequester,
  canKill,
}: {
  request: RequestDetail
  isRequester: boolean
  canKill: boolean
}) {
  const action = <NextActions request={request} isRequester={isRequester} canKill={canKill} />
  const changedCount = request.changedTaskIds.length

  switch (request.status) {
    case 'ANALYZING':
      return (
        <Banner tone="info" title="AI가 Plan을 분석하는 중입니다">
          끝나면 작업 목록이 나타납니다.
        </Banner>
      )
    case 'ANALYSIS_FAILED':
      return <AnalysisFailedPanel request={request} isRequester={isRequester} />
    case 'REVIEWING':
      return (
        <Banner tone="info" title={isRequester ? 'Plan을 확인하고 제출해 주세요' : '요청자가 Plan을 검토하는 중입니다'} action={action}>
          제출 전이라 아직 아무 승인도 없습니다.
        </Banner>
      )
    case 'PENDING_APPROVAL': {
      const waiting = waitingRows(request)
      // 승인이 다 모였는데 승인대기면 웹쉘에 연결되지 않아 웹 서비스가 실행 요청을 다시 시도하는 중이다 (API 명세 4.5).
      if (request.plan && waiting.length === 0) {
        return (
          <Banner tone="warning" title="승인은 모두 모였지만 웹쉘에 연결할 수 없습니다" action={action}>
            연결되면 실행을 자동으로 다시 요청합니다.
          </Banner>
        )
      }
      return (
        <Banner
          tone="info"
          title={request.plan?.kind === 'ROLLBACK' ? '문서 롤백 승인을 기다립니다' : '승인권자의 승인을 기다립니다'}
          action={action}
        >
          <WaitingFor rows={waiting} />
          <p className="text-ink-2">승인이 모두 모이면 웹쉘이 서명과 해시를 직접 검증한 뒤 실행합니다.</p>
        </Banner>
      )
    }
    case 'REAPPROVAL_REQUIRED':
      return (
        <Banner tone="warning" title="Plan이 바뀌어 기존 승인 서명이 모두 무효가 되었습니다" action={action}>
          <p>{changedCount > 0 ? `바뀐 작업 ${changedCount}개를 확인한 뒤 다시 제출해 주세요.` : 'Plan을 확인한 뒤 다시 제출해 주세요.'}</p>
          {request.removedTaskTitles.length > 0 && <p>삭제된 작업: {request.removedTaskTitles.join(', ')}</p>}
        </Banner>
      )
    case 'VERIFICATION_FAILED':
      return (
        // 무엇이 실패했는지는 바로 아래 트리의 검증 관문이 쉬운 말로 보여 준다. 배너는 다음 할 일과 기록용 코드만 둔다.
        <Banner tone="danger" title="위변조 가능성이 있어 관리자와 부서 관리자에게 경보를 보냈습니다" action={action}>
          <p>다시 제출하면 승인 서명을 새로 받습니다.</p>
          <p className="mt-1 flex flex-wrap gap-x-3">
            {request.failedChecks.map((check) => (
              <Mono key={check}>{check}</Mono>
            ))}
          </p>
        </Banner>
      )
    case 'RUNNING':
      // 진행 상황은 바로 아래 트리가 보여 준다. 배너는 멈추는 방법만 알린다.
      return canKill ? <Banner tone="info" title="실행을 멈춰야 하면 킬 스위치로 중단할 수 있습니다" action={action} /> : null
    case 'ROLLING_BACK':
      return <Banner tone="info" title="문서를 이전 버전으로 되돌리는 중입니다" />
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
        <Banner tone="warning" title="일부 작업만 성공했습니다" action={action}>
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
