import type { AuditLog, Dashboard, PendingApproval, RequestStatus, RequestSummary, Risk } from '../../types'
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
import { isCandidate, isExternallyApprovable, matchRequirement } from '../policy'
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

function inDepartment(request: StoredRequest, departmentId: string | null): boolean {
  if (!departmentId) return false
  return (
    request.requester.departmentId === departmentId || requireProject(request.projectId).departmentId === departmentId
  )
}

/** 역할별 조회 범위 (기능 명세서 3.2) */
function inScope(request: StoredRequest, user: StoredUser): boolean {
  if (user.role === 'ADMIN') return true
  if (user.role === 'DEPT_MANAGER') return inDepartment(request, user.departmentId)
  return request.requester.id === user.id
}

function canView(request: StoredRequest, user: StoredUser): boolean {
  return (
    inScope(request, user) || isCandidate(user, request) || request.approvals.some((a) => a.userId === user.id)
  )
}

function viewable(ctx: Ctx): StoredRequest {
  const request = requireRequest(ctx.params.requestId)
  if (!canView(request, ctx.me)) throw new HttpError(404, 'NOT_FOUND', '요청을 찾을 수 없습니다')
  return request
}

const TERMINAL: RequestStatus[] = ['RUNNING', 'ROLLING_BACK']

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
        if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`))
      }
      for (const line of db().logs[request.id] ?? []) send(line)
      if (!TERMINAL.includes(request.status)) {
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

function pendingFor(user: StoredUser, network: 'INTERNAL' | 'EXTERNAL'): PendingApproval[] {
  const items: PendingApproval[] = []
  for (const request of db().requests) {
    if (request.status !== 'PENDING_APPROVAL' || !request.plan) continue
    const project = requireProject(request.projectId)
    for (const task of request.plan.tasks) {
      if (task.status !== 'PENDING' || !matchRequirement(user, task, request)) continue
      items.push({
        requestId: request.id,
        taskId: task.id,
        taskTitle: task.title,
        type: task.type,
        risk: task.risk,
        requester: request.requester,
        projectId: project.id,
        projectName: project.name,
        requestedAt: request.submittedAt ?? request.createdAt,
        blockedReason: network === 'EXTERNAL' && !isExternallyApprovable(task) ? 'INTERNAL_NETWORK_ONLY' : null,
      })
    }
  }
  // 오래 기다린 순
  return items.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))
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

  const riskDistribution: Record<Risk, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, FORBIDDEN: 0 }
  const statusCounts: Dashboard['statusCounts'] = {}
  for (const request of selected) {
    statusCounts[request.status] = (statusCounts[request.status] ?? 0) + 1
    for (const task of request.plan?.tasks ?? []) riskDistribution[task.risk] += 1
  }
  const result: Dashboard = {
    scope,
    requestCount: selected.length,
    pendingApprovalCount: selected.filter((r) => r.status === 'PENDING_APPROVAL').length,
    riskDistribution,
    statusCounts,
  }
  if (scope === 'COMPANY') {
    result.byDepartment = database.departments.map((department) => {
      const requests = selected.filter((r) => inDepartment(r, department.id))
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

/** 역할별 감사 로그 범위: 관리자 전체, 부서 관리자 소속 부서, 직원 본인 요청 */
function auditInScope(log: AuditLog, user: StoredUser): boolean {
  if (user.role === 'ADMIN') return true
  const request = log.target.requestId ? db().requests.find((r) => r.id === log.target.requestId) : undefined
  if (user.role === 'DEPT_MANAGER') {
    if (request) return inDepartment(request, user.departmentId)
    const actor = db().users.find((u) => u.id === log.actor.id)
    return actor?.departmentId === user.departmentId
  }
  return request?.requester.id === user.id
}

function auditMatches(log: AuditLog, query: URLSearchParams): boolean {
  const actorId = query.get('actorId')
  const departmentId = query.get('departmentId')
  const projectId = query.get('projectId')
  const requestId = query.get('requestId')
  const action = query.get('action')
  const network = query.get('network')
  const from = query.get('from')
  const to = query.get('to')
  const database = db()
  const request = log.target.requestId ? database.requests.find((r) => r.id === log.target.requestId) : undefined
  if (actorId && log.actor.id !== actorId) return false
  if (departmentId && database.users.find((u) => u.id === log.actor.id)?.departmentId !== departmentId) return false
  if (projectId && (log.target.projectId ?? request?.projectId) !== projectId) return false
  if (requestId && log.target.requestId !== requestId) return false
  if (action && log.action !== action) return false
  if (network && log.network !== network) return false
  if (from && log.at < from) return false
  if (to && log.at > to) return false
  return true
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
  route('POST', '/admin/kill-all', ({ me, body }) => ({ killedRequestIds: killAll(me, body?.reason ?? '') }), {
    roles: ['ADMIN'],
  }),
  route('POST', '/requests/:requestId/retry', ({ me, params }) => retryFailedTasks(requireRequest(params.requestId), me), {
    internal: true,
  }),
  route('GET', '/requests/:requestId/logs', (ctx) => paginate(db().logs[viewable(ctx).id] ?? [], ctx.query)),
  route('GET', '/requests/:requestId/logs/stream', logStream),

  // ── 승인 ────────────────────────────────────────────────
  route('GET', '/approvals/pending', ({ me, network, query }) => paginate(pendingFor(me, network), query)),
  route('GET', '/requests/:requestId/approval-context', ({ me, network, params }) =>
    approvalContext(requireRequest(params.requestId), me, network),
  ),
  route('POST', '/requests/:requestId/approvals', ({ me, network, params, body }) =>
    submitApproval(requireRequest(params.requestId), me, network, body),
  ),
  route('POST', '/requests/:requestId/rejections', ({ me, network, params, body }) => {
    const request = requireRequest(params.requestId)
    rejectRequest(request, me, network, body)
    return { id: request.id, status: request.status }
  }),

  // ── 문서 롤백 ───────────────────────────────────────────
  route('GET', '/requests/:requestId/tasks/:taskId/document', (ctx) =>
    taskDocument(viewable(ctx), ctx.params.taskId),
  ),
  route('POST', '/requests/:requestId/rollback', ({ me, params, body }) =>
    requestRollback(requireRequest(params.requestId), me, body), { internal: true },
  ),

  // ── 대시보드·감사 로그 ──────────────────────────────────
  route('GET', '/dashboard', buildDashboard),
  route('GET', '/audit-logs', ({ me, query }) =>
    paginate(
      db().auditLogs.filter((log) => auditInScope(log, me) && auditMatches(log, query)),
      query,
    ),
  ),
  route('GET', '/audit-logs/:logId', ({ me, params }) => {
    const log = db().auditLogs.find((l) => l.id === params.logId)
    if (!log || !auditInScope(log, me)) throw new HttpError(404, 'NOT_FOUND', '기록을 찾을 수 없습니다')
    return log
  }),
]
