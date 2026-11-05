import type { Dashboard, PendingApproval, RequestStatus, RequestSummary, Risk } from '../../types'
import {
  approvalContext,
  cancelRequest,
  createRequest,
  killAll,
  killRequest,
  patchPlan,
  rejectRequest,
  requestRollback,
  retryAnalysis,
  retryFailedTasks,
  submitApproval,
  submitRequest,
  taskDocument,
  toDetail,
} from '../engine'
import { downloadDocument, listDocumentVersions, previewDocumentVersion, previewLatestDocument } from '../approvalDocument'
import { auditExportRoutes } from '../auditExport'
import { auditInScope, inDepartment, selectAuditLogs } from '../auditScope'
import { isCandidate, matchRequirement } from '../policy'
import { progressStream, progressTree } from '../progress'
import { paginate, route, type Ctx, type Route } from '../router'
import {
  HttpError,
  db,
  requireProject,
  requireRequest,
  subscribeLogs,
  type StoredRequest,
  type StoredUser,
} from '../store'

function toSummary(request: StoredRequest): RequestSummary {
  return {
    id: request.id,
    projectId: request.projectId,
    requester: request.requester,
    prompt: request.prompt,
    source: request.source,
    status: request.status,
    analysisAttempts: request.analysisAttempts,
    currentPlanId: request.currentPlanId,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  }
}

/** 역할별 조회 범위 (기능 명세서 3.2) */
function inScope(request: StoredRequest, user: StoredUser): boolean {
  if (user.role === 'ADMIN') return true
  if (user.role === 'DEPT_MANAGER') return inDepartment(request, user.departmentId)
  return request.requester.id === user.id
}

function canView(request: StoredRequest, user: StoredUser): boolean {
  // 제출 전의 Plan은 아직 승인 대상이 아니므로 승인 후보에게 보이지 않는다.
  const submitted = Boolean(request.plan?.planHash)
  return (
    inScope(request, user) ||
    (submitted && isCandidate(user, request)) ||
    request.approvals.some((a) => a.userId === user.id)
  )
}

function viewable(ctx: Ctx): StoredRequest {
  const request = requireRequest(ctx.params.requestId)
  if (!canView(request, ctx.me)) throw new HttpError(404, 'NOT_FOUND', '요청을 찾을 수 없습니다')
  return request
}

/** 로그가 더 나올 수 있는 상태 */
const LIVE_STATUSES: RequestStatus[] = ['RUNNING', 'ROLLING_BACK']

/** 서버처럼 이벤트 이름은 log이고 id가 없으며 지난 줄을 보내지 않는다. 지난 줄은 목록 API로 읽는다. */
function logStream(ctx: Ctx): Response {
  const request = viewable(ctx)
  const encoder = new TextEncoder()
  let unsubscribe = () => {}
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      const close = () => {
        if (closed) return
        closed = true
        unsubscribe()
        controller.close()
      }
      const send = (value: unknown) => {
        if (!closed) controller.enqueue(encoder.encode(`event: log\ndata: ${JSON.stringify(value)}\n\n`))
      }
      if (ctx.signal?.aborted) {
        close()
        return
      }
      if (!LIVE_STATUSES.includes(request.status)) {
        close()
        return
      }
      unsubscribe = subscribeLogs(request.id, { onLine: send, onEnd: close })
      ctx.signal?.addEventListener('abort', close)
    },
    cancel() {
      unsubscribe()
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
}

function pendingFor(user: StoredUser): PendingApproval[] {
  const items: PendingApproval[] = []
  for (const request of db().requests) {
    if (request.status !== 'PENDING_APPROVAL' || !request.plan) continue
    for (const task of request.plan.tasks) {
      if (task.status !== 'PENDING' || !matchRequirement(user, task, request)) continue
      items.push({ requestId: request.id, planId: request.plan.id, requester: request.requester, requestedAt: request.createdAt, task })
    }
  }
  // 서버처럼 최근 요청부터 준다. 오래 기다린 순 정렬은 화면이 한다.
  return items.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
}

function buildDashboard(ctx: Ctx): Dashboard {
  const { me, query } = ctx
  const database = db()
  const scope = (query.get('scope') ?? 'ME') as Dashboard['scope']
  if (scope === 'COMPANY' && me.role !== 'ADMIN') throw new HttpError(403, 'FORBIDDEN_ROLE', '권한이 없습니다')
  if (scope === 'DEPARTMENT' && me.role === 'EMPLOYEE') throw new HttpError(403, 'FORBIDDEN_ROLE', '권한이 없습니다')

  const departmentId = me.role === 'ADMIN' ? (query.get('departmentId') ?? me.departmentId) : me.departmentId
  const selected = database.requests.filter((request) => {
    if (scope === 'COMPANY') return true
    if (scope === 'DEPARTMENT') return inDepartment(request, departmentId)
    return request.requester.id === me.id
  })

  const riskCounts: Record<Risk, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, FORBIDDEN: 0 }
  const statusCounts: Dashboard['statusCounts'] = {}
  for (const request of selected) {
    statusCounts[request.status] = (statusCounts[request.status] ?? 0) + 1
    for (const task of request.plan?.tasks ?? []) riskCounts[task.risk] += 1
  }
  const result: Dashboard = {
    scope,
    requestCount: selected.length,
    pendingApprovalCount: selected.filter((r) => r.status === 'PENDING_APPROVAL').length,
    riskCounts,
    statusCounts,
  }
  if (scope === 'COMPANY') {
    result.byDepartment = database.departments.map((department) => {
      // 요청자 부서까지 세면 다른 부서 프로젝트에 낸 요청이 두 번 잡혀 합이 전체보다 커진다. 프로젝트 소속 부서 하나로 센다.
      const requests = selected.filter((r) => requireProject(r.projectId).departmentId === department.id)
      return {
        departmentId: department.id,
        name: department.name,
        requests: requests.length,
        pendingApprovals: requests.filter((r) => r.status === 'PENDING_APPROVAL').length,
        running: requests.filter((r) => r.status === 'RUNNING').length,
      }
    })
  }
  return result
}

export const requestRoutes: Route[] = [
  // ── 작업 요청·Plan·실행 ─────────────────────────────────
  route(
    'POST',
    '/requests',
    ({ me, body }) => {
      if (!body.projectId) throw new HttpError(400, 'VALIDATION_ERROR', '프로젝트를 고르세요')
      if (!body.prompt?.trim()) throw new HttpError(400, 'VALIDATION_ERROR', '프롬프트를 입력해 주세요')
      const request = createRequest(me, body.projectId, body.prompt.trim())
      return { id: request.id, status: request.status }
    },
    { internal: true, status: 202 },
  ),
  route('GET', '/requests', ({ me, query }) => {
    const mine = query.get('mine') === 'true'
    const status = query.get('status')
    const projectId = query.get('projectId')
    const items = db()
      .requests.filter(
        (r) =>
          (mine ? r.requester.id === me.id : inScope(r, me)) &&
          (!status || r.status === status) &&
          (!projectId || r.projectId === projectId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toSummary)
    return paginate(items, query)
  }),
  route('GET', '/requests/:requestId', (ctx) => toDetail(viewable(ctx))),
  route(
    'POST',
    '/requests/:requestId/analysis/retry',
    ({ me, params }) => {
      const request = requireRequest(params.requestId)
      retryAnalysis(request, me)
      return { id: request.id, status: request.status }
    },
    { internal: true, status: 202 },
  ),
  route(
    'PATCH',
    '/requests/:requestId/plan',
    ({ me, params, body }) => {
      const request = requireRequest(params.requestId)
      patchPlan(request, me, body)
      return { id: request.id, status: request.status }
    },
    { internal: true, status: 202 },
  ),
  route('POST', '/requests/:requestId/submit', ({ me, params }) => submitRequest(requireRequest(params.requestId), me), {
    internal: true,
  }),
  route('POST', '/requests/:requestId/cancel', ({ me, params }) => {
    const request = requireRequest(params.requestId)
    cancelRequest(request, me)
    return { id: request.id, status: request.status }
  }),
  route('POST', '/requests/:requestId/kill', ({ me, params, body }) =>
    killRequest(requireRequest(params.requestId), me, body?.reason ?? ''),
  ),
  route('POST', '/admin/kill-all', ({ me, body }) => ({ status: 'KILLED', executionIds: killAll(me, body?.reason ?? '') }), {
    roles: ['ADMIN'],
  }),
  route('POST', '/requests/:requestId/retry', ({ me, params }) => retryFailedTasks(requireRequest(params.requestId), me), {
    internal: true,
  }),
  route('GET', '/requests/:requestId/logs', (ctx) => paginate(db().logs[viewable(ctx).id] ?? [], ctx.query)),
  route('GET', '/requests/:requestId/logs/stream', logStream),
  route('GET', '/requests/:requestId/progress', (ctx) => progressTree(viewable(ctx))),
  route('GET', '/requests/:requestId/progress/stream', (ctx) => {
    const request = viewable(ctx)
    return progressStream(request, ctx.headers.get('Last-Event-ID'), ctx.signal, () => canView(request, ctx.me))
  }),

  // ── 승인 ────────────────────────────────────────────────
  route('GET', '/approvals/pending', ({ me, query }) => paginate(pendingFor(me), query)),
  route('GET', '/requests/:requestId/approval-context', (ctx) => approvalContext(viewable(ctx), ctx.me, ctx.network)),
  // 서버의 승인·거부 API는 내부망 전용이다 (ApprovalController).
  route(
    'POST',
    '/requests/:requestId/approvals',
    ({ me, network, params, body }) => submitApproval(requireRequest(params.requestId), me, network, body),
    { internal: true },
  ),
  route(
    'POST',
    '/requests/:requestId/rejections',
    ({ me, network, params, body }) => {
      const request = requireRequest(params.requestId)
      rejectRequest(request, me, network, body)
      return { requestId: request.id, status: request.status }
    },
    { internal: true },
  ),

  // ── 승인 기록 문서 ──────────────────────────────────────
  route('GET', '/requests/:requestId/approval-document', (ctx) => previewLatestDocument(viewable(ctx))),
  route('GET', '/requests/:requestId/approval-document/versions', (ctx) => paginate(listDocumentVersions(viewable(ctx)), ctx.query)),
  route('GET', '/requests/:requestId/approval-document/versions/:version', (ctx) => previewDocumentVersion(viewable(ctx), ctx.params.version)),
  route('GET', '/requests/:requestId/approval-document/pdf', (ctx) => downloadDocument(viewable(ctx))),

  // ── 문서 롤백 ───────────────────────────────────────────
  route('GET', '/requests/:requestId/tasks/:taskId/document', (ctx) =>
    taskDocument(viewable(ctx), ctx.params.taskId),
  ),
  route('POST', '/requests/:requestId/rollback', ({ me, params, body }) =>
    requestRollback(requireRequest(params.requestId), me, body), { internal: true },
  ),

  // ── 대시보드·감사 로그 ──────────────────────────────────
  route('GET', '/dashboard', buildDashboard),
  route('GET', '/audit-logs', ({ me, query }) => paginate(selectAuditLogs(me, query), query)),
  // /audit-logs/:logId보다 먼저 와야 exports가 logId로 잡히지 않는다.
  ...auditExportRoutes,
  route('GET', '/audit-logs/:logId', ({ me, params }) => {
    const log = db().auditLogs.find((l) => l.id === params.logId)
    if (!log || !auditInScope(log, me)) throw new HttpError(404, 'NOT_FOUND', '기록을 찾을 수 없습니다')
    return log
  }),
]
