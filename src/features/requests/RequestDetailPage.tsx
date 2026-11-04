import { Loader2 } from 'lucide-react'
import { useParams } from 'react-router'
import { useMe } from '../../app/AuthProvider'
import type { RequestDetail, RequestStatus, Risk } from '../../api/types'
import { LogViewer } from '../../components/LogViewer'
import { RiskSummary } from '../../components/rich'
import { TaskCard } from '../../components/TaskCard'
import { Banner, EmptyState, ErrorState, Mono, PageHeader, Sheet, Spinner } from '../../components/ui'
import { FAILED_CHECK_LABEL } from '../../lib/labels'
import { useProjects, useRequest } from '../../lib/queries'
import { RequestDetailRail } from './RequestDetailRail'
import { AnalysisFailedPanel, RequestMeta, TaskEditButtons } from './RequestParts'
import { RequestTimeline } from './RequestTimeline'

const PLAN_EDITABLE: RequestStatus[] = ['PENDING_APPROVAL', 'PARTIALLY_COMPLETED']
const LIVE: RequestStatus[] = ['RUNNING', 'ROLLING_BACK']

/** 지금 상태가 무슨 뜻인지 알려 준다. 눌러서 할 일은 오른쪽 패널에 모았다. */
function StatusNotice({ request, isRequester }: { request: RequestDetail; isRequester: boolean }) {
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
        <Banner tone="info" title={isRequester ? 'Plan을 확인하고 제출해 주세요' : '요청자가 Plan을 검토하는 중입니다'}>
          제출 전이라 아직 아무 승인도 없습니다.
        </Banner>
      )
    case 'PENDING_APPROVAL':
      return (
        <Banner
          tone="info"
          title={request.plan?.kind === 'ROLLBACK' ? '문서 롤백 승인을 기다립니다' : '승인권자의 승인을 기다립니다'}
        >
          필요한 승인이 모두 모이면 실행기가 서명과 해시를 다시 검증한 뒤 실행합니다.
        </Banner>
      )
    case 'REAPPROVAL_REQUIRED':
      return (
        <Banner tone="warning" title="Plan이 바뀌어 기존 승인 서명이 모두 무효가 되었습니다">
          {changedCount > 0 && <p>바뀐 작업 {changedCount}개를 아래에 강조했습니다. 확인한 뒤 다시 제출해 주세요.</p>}
          {changedCount === 0 && <p>Plan을 확인한 뒤 다시 제출해 주세요.</p>}
          {request.removedTaskTitles.length > 0 && <p>삭제된 작업: {request.removedTaskTitles.join(', ')}</p>}
        </Banner>
      )
    case 'VERIFICATION_FAILED':
      return (
        <Banner tone="danger" title="실행기가 승인 서명 검증에 실패해 실행하지 않았습니다">
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
        <Banner tone="warning" title="일부 작업만 성공했습니다">
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

function TaskList({ request, canEditPlan }: { request: RequestDetail; canEditPlan: boolean }) {
  const tasks = request.plan?.tasks ?? []
  if (tasks.length === 0) {
    return (
      <Sheet>
        <EmptyState title="아직 작업이 없습니다">
          {request.status === 'ANALYZING'
            ? 'AI가 Plan을 만들면 여기에 작업이 나옵니다.'
            : 'Plan이 만들어지지 않은 요청입니다.'}
        </EmptyState>
      </Sheet>
    )
  }
  const risks: Record<Risk, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, FORBIDDEN: 0 }
  for (const task of tasks) risks[task.risk] += 1
  return (
    <section aria-label="작업 목록" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[0.9375rem] font-semibold">작업 {tasks.length}개</h2>
        <RiskSummary risks={risks} />
      </div>
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
        />
      ))}
    </section>
  )
}

export default function RequestDetailPage() {
  const { requestId } = useParams()
  const me = useMe()
  const query = useRequest(requestId)
  const projects = useProjects()

  if (query.isPending) return <Spinner />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  const request = query.data

  const isRequester = request.requester.id === me.id
  const hasSigned = request.approvalStatus.some((status) =>
    status.requirements.some((requirement) => requirement.approvedBy.some((record) => record.userId === me.id)),
  )
  // 관리자는 전체, 부서 관리자는 소속 부서, 나머지는 본인 요청이나 본인이 승인한 작업만 멈출 수 있다 (3.2).
  const projectDepartmentId = projects.data?.find((project) => project.id === request.projectId)?.departmentId
  const managesProject = me.role === 'DEPT_MANAGER' && me.departmentId === projectDepartmentId
  const canKill = request.status === 'RUNNING' && (me.role === 'ADMIN' || managesProject || isRequester || hasSigned)
  const canEditPlan = isRequester && PLAN_EDITABLE.includes(request.status)
  const live = LIVE.includes(request.status)
  const hasRun = request.events.some((event) => event.status === 'RUNNING' || event.status === 'ROLLING_BACK')
  const log = hasRun && <LogViewer requestId={request.id} live={live} />

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
      />

      <div className="mb-4 flex flex-col gap-3">
        <RequestTimeline request={request} />
        <div className="empty:hidden">
          <StatusNotice request={request} isRequester={isRequester} />
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_360px] items-start gap-4">
        <div className="flex min-w-0 flex-col gap-4">
          {/* 실행 중에는 로그가 가장 궁금하므로 맨 위에 둔다 */}
          {live && log}
          <TaskList request={request} canEditPlan={canEditPlan} />
          {!live && log}
        </div>
        <RequestDetailRail request={request} isRequester={isRequester} canKill={canKill} />
      </div>
    </>
  )
}
