import { useParams } from 'react-router'
import { useMe } from '../../app/AuthProvider'
import type { RequestDetail, RequestStatus, TaskStatus } from '../../api/types'
import { RequestStatusBadge } from '../../components/badges'
import { TaskCard, TaskRows } from '../../components/TaskCard'
import { ErrorState, PageHeader, Spinner } from '../../components/ui'
import { useApprovalStatuses } from '../../lib/approvalStatus'
import { useProjects, useRequest } from '../../lib/queries'
import { ApprovalDocumentSection } from '../approvals/ApprovalDocumentSection'
import { ProgressSection } from '../progress/ProgressTree'
import { MoreDetails, RunLog, TaskApprovalLine } from './RequestDetailSections'
import { approvalToShow } from './requestPaths'
import { RequestMeta, TaskEditButtons } from './RequestParts'
import { RequestStatusBanner } from './RequestStatusBanner'
import { RequestTimeline } from './RequestTimeline'

const PLAN_EDITABLE: RequestStatus[] = ['PENDING_APPROVAL', 'PARTIALLY_COMPLETED']
const LIVE: RequestStatus[] = ['RUNNING', 'ROLLING_BACK']
/** 승인 현황 줄이 같은 말을 하므로 배지를 함께 그리지 않는 작업 상태 */
const SAID_BY_APPROVAL_LINE: TaskStatus[] = ['PENDING', 'APPROVED']
/** 실행을 시작한 뒤에만 갈 수 있는 상태. 이때는 실행 로그를 볼 수 있다 */
const RAN: RequestStatus[] = ['RUNNING', 'ROLLING_BACK', 'KILLED', 'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'ROLLED_BACK', 'ROLLBACK_FAILED']

function TaskList({ request, canEditPlan }: { request: RequestDetail; canEditPlan: boolean }) {
  const statuses = useApprovalStatuses(request)
  const tasks = request.currentPlan?.tasks ?? []
  if (tasks.length === 0) return null
  return (
    <section aria-label="작업 목록" className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">작업 {tasks.length}개</h2>
      <TaskRows>
        {tasks.map((task) => {
          const approval = approvalToShow(statuses, request, task)
          return (
            <TaskCard
              key={task.id}
              task={task}
              requestId={request.id}
              highlighted={request.status === 'REAPPROVAL_REQUIRED' && request.changedTaskIds?.includes(task.id)}
              spotlight={
                request.status === 'RUNNING' && task.status === 'RUNNING'
                  ? 'running'
                  : request.status === 'PARTIALLY_COMPLETED' && task.status === 'FAILED'
                    ? 'failed'
                    : undefined
              }
              showStatus={!(approval && SAID_BY_APPROVAL_LINE.includes(task.status))}
              actions={
                canEditPlan && task.status !== 'SUCCEEDED' ? (
                  <TaskEditButtons task={task} request={request} voidsApprovals />
                ) : undefined
              }
              footer={approval && <TaskApprovalLine status={approval} />}
            />
          )
        })}
      </TaskRows>
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
  const hasSigned = request.approvals.some((approval) => approval.approverId === me.id)
  // 관리자는 전체, 부서 관리자는 소속 부서, 나머지는 본인 요청이나 본인이 승인한 작업만 멈출 수 있다 (3.2).
  const projectDepartmentId = projects.data?.find((project) => project.id === request.projectId)?.departmentId
  const managesProject = me.role === 'DEPT_MANAGER' && me.departmentId === projectDepartmentId
  const canKill = request.status === 'RUNNING' && (me.role === 'ADMIN' || managesProject || isRequester || hasSigned)
  const canEditPlan = isRequester && PLAN_EDITABLE.includes(request.status)
  const live = LIVE.includes(request.status)
  // 진행 기록은 서버에 없다. 있으면(목) 재시도 전의 실행도 찾아 준다.
  const hasRun = RAN.includes(request.status) || Boolean(request.events?.some((event) => RAN.includes(event.status)))

  return (
    <div className="flex flex-col gap-6 [&>header]:mb-0">
      <PageHeader
        title={request.prompt}
        meta={
          <>
            <RequestStatusBadge status={request.status} />
            <RequestMeta request={request} />
          </>
        }
      />
      <RequestTimeline request={request} />
      <RequestStatusBanner request={request} isRequester={isRequester} canKill={canKill} />
      <ProgressSection key={request.id} requestId={request.id} defaultOpen />
      <div className="flex flex-col gap-6">
        <TaskList request={request} canEditPlan={canEditPlan} />
        {/* 실행 중에는 로그가 가장 궁금하므로 작업 위로 올린다. 같은 자리의 요소라 끝나도 다시 불러오지 않는다. */}
        {hasRun && (
          <div className={live ? '-order-1' : ''}>
            <RunLog requestId={request.id} live={live} />
          </div>
        )}
        <ApprovalDocumentSection key={request.id} request={request} />
        <MoreDetails request={request} />
      </div>
    </div>
  )
}
