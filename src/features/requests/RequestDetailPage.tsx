import { useParams } from 'react-router'
import { useMe } from '../../app/AuthProvider'
import type { RequestDetail, RequestStatus, TaskStatus } from '../../api/types'
import { RequestStatusBadge } from '../../components/badges'
import { TaskCard } from '../../components/TaskCard'
import { ErrorState, PageHeader, Spinner } from '../../components/ui'
import { useProjects, useRequest } from '../../lib/queries'
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

function TaskList({ request, canEditPlan }: { request: RequestDetail; canEditPlan: boolean }) {
  const tasks = request.plan?.tasks ?? []
  if (tasks.length === 0) return null
  return (
    <section aria-label="작업 목록" className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">작업 {tasks.length}개</h2>
      {tasks.map((task) => {
        const approval = approvalToShow(request, task)
        const spotlight = (request.status === 'RUNNING' && task.status === 'RUNNING') || (request.status === 'PARTIALLY_COMPLETED' && task.status === 'FAILED')
        const card = (
          <TaskCard
            key={task.id}
            task={task}
            requestId={request.id}
            highlighted={request.status === 'REAPPROVAL_REQUIRED' && request.changedTaskIds.includes(task.id)}
            showStatus={!(approval && SAID_BY_APPROVAL_LINE.includes(task.status))}
            actions={
              canEditPlan && task.status !== 'SUCCEEDED' ? (
                <TaskEditButtons task={task} request={request} voidsApprovals />
              ) : undefined
            }
            footer={approval && <TaskApprovalLine status={approval} />}
          />
        )
        if (!spotlight) return card
        const ring = task.status === 'FAILED' ? 'ring-high' : 'ring-seal'
        return (
          <div key={task.id} className={`rounded-xl ring-2 ring-offset-2 ring-offset-paper ${ring}`}>
            {card}
          </div>
        )
      })}
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

  return (
    <div className="flex flex-col gap-5">
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
      <div className="flex flex-col gap-5">
        <TaskList request={request} canEditPlan={canEditPlan} />
        {/* 실행 중에는 로그가 가장 궁금하므로 작업 위로 올린다. 같은 자리의 요소라 끝나도 다시 불러오지 않는다. */}
        {hasRun && (
          <div className={live ? '-order-1' : ''}>
            <RunLog requestId={request.id} live={live} />
          </div>
        )}
        <MoreDetails request={request} />
      </div>
    </div>
  )
}
