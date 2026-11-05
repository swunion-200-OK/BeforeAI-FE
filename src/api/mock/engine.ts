/** 요청의 상태 전이 (기능 명세서 6장, API 명세서 6장). 라우트는 이 함수들만 부른다. */
import { hashService, toHashTarget } from '../../crypto/hashService'
import { makeUnifiedDiff } from '../../lib/diff'
import type {
  ApprovalContext,
  ApprovalEnvelope,
  Plan,
  PlanChange,
  PlanRetryResponse,
  RejectBody,
  RequestApproval,
  RequestDetail,
  RequestStatus,
  SubmitApprovalResponse,
  SubmitResponse,
  Task,
} from '../types'
import {
  CLARIFICATION_QUESTION,
  analyzePrompt,
  applyInstruction,
  editorTask,
  isAmbiguous,
  makePlan,
  toTask,
} from './analysis'
import {
  buildRequiredApprovers,
  isCandidate,
  isExternallyApprovable,
  isTaskFullyApproved,
  matchRequirement,
} from './policy'
import {
  HttpError,
  archivePlan,
  audit,
  db,
  endLogs,
  generation,
  mockConfig,
  notify,
  nowIso,
  persist,
  requireProject,
  setStatus,
  type PendingAnalysis,
  type StoredRequest,
  type StoredUser,
} from './store'
import { recordSubmission } from './approvalDocument'
import { resumeAuditExports } from './auditExport'
import {
  assertWebshellReachable,
  isAwaitingExecution,
  reportFinalStatus,
  requestExecution,
  scheduleExecution,
  scheduleExecutionRetry,
} from './webshell'

const MAX_ANALYSIS_ATTEMPTS = 3

function assertStatus(request: StoredRequest, allowed: RequestStatus[]) {
  if (!allowed.includes(request.status)) {
    throw new HttpError(409, 'INVALID_STATE', '지금 상태에서는 할 수 없는 동작입니다', { status: request.status })
  }
}

function assertRequester(request: StoredRequest, user: StoredUser) {
  if (request.requester.id !== user.id) throw new HttpError(403, 'FORBIDDEN_ROLE', '요청자만 할 수 있습니다')
}

/** 서버 ApprovalResponse 모양. 현재 Plan의 승인만 준다. 목은 작업별로 저장하므로 승인 기록 ID로 다시 묶는다. */
export function toApprovals(request: StoredRequest): RequestApproval[] {
  const grouped = new Map<string, RequestApproval>()
  for (const approval of request.approvals) {
    if (approval.planId !== request.currentPlanId) continue
    const found = grouped.get(approval.id)
    if (found) found.taskIds.push(approval.taskId)
    else {
      grouped.set(approval.id, {
        id: approval.id,
        planId: approval.planId,
        approverId: approval.userId,
        taskIds: [approval.taskId],
        network: approval.network,
        createdAt: approval.at,
      })
    }
  }
  return [...grouped.values()]
}

export function toDetail(request: StoredRequest): RequestDetail {
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
    currentPlan: request.plan,
    approvals: toApprovals(request),
    clarification: request.clarification,
    changedTaskIds: request.changedTaskIds,
    removedTaskTitles: request.removedTaskTitles,
    failedChecks: request.failedChecks,
    approvalRecordCount: request.approvalRecords.filter((record) => record.planId === request.currentPlanId).length,
    rejection: request.rejection,
    kill: request.kill,
    events: request.events,
  }
}

// ── 분석 ───────────────────────────────────────────────────

export function createRequest(
  user: StoredUser,
  projectId: string,
  prompt: string,
  source: StoredRequest['source'] = 'PROMPT',
  pending: PendingAnalysis = { kind: 'NEW' },
): StoredRequest {
  requireProject(projectId)
  const now = nowIso()
  const request: StoredRequest = {
    id: `r-${crypto.randomUUID().slice(0, 8)}`,
    projectId,
    requester: { id: user.id, name: user.name, departmentId: user.departmentId },
    prompt,
    source,
    status: 'ANALYZING',
    analysisAttempts: 1,
    currentPlanId: null,
    createdAt: now,
    updatedAt: now,
    plan: null,
    approvals: [],
    approvalRecords: [],
    webshellEvents: [],
    pendingAnalysis: pending,
    submittedAt: null,
    clarification: null,
    changedTaskIds: [],
    removedTaskTitles: [],
    failedChecks: [],
    rejection: null,
    kill: null,
    events: [{ status: 'ANALYZING', at: now, by: user.name }],
  }
  db().requests.unshift(request)
  audit(user, 'REQUEST_CREATED', { requestId: request.id, projectId }, { source })
  scheduleAnalysis(request.id)
  return request
}

export function scheduleAnalysis(requestId: string) {
  const startedGeneration = generation
  setTimeout(() => {
    if (startedGeneration !== generation) return
    const request = db().requests.find((r) => r.id === requestId)
    if (!request || request.status !== 'ANALYZING' || request.frozen) return
    finishAnalysis(request)
    persist()
  }, mockConfig.analysisMs)
}

function finishAnalysis(request: StoredRequest) {
  const pending = request.pendingAnalysis ?? { kind: 'NEW' as const }
  const project = requireProject(request.projectId)
  request.pendingAnalysis = null

  if (pending.kind === 'PATCH') {
    applyPlanChanges(request, pending.changes, pending.returnStatus)
    return
  }
  if (pending.kind === 'EDITOR') {
    const tasks = [editorTask(project, request.requester, pending.description, pending.files)]
    request.plan = makePlan(request.id, project, tasks)
    request.currentPlanId = request.plan.id
    setStatus(request, 'REVIEWING', 'AI 분석')
    return
  }
  if (request.prompt.includes('#분석실패')) {
    setStatus(request, 'ANALYSIS_FAILED', 'AI 분석')
    return
  }
  const prompt = pending.kind === 'ANSWER' ? `${request.prompt} ${pending.answer}` : request.prompt
  if (pending.kind === 'NEW' && isAmbiguous(prompt)) {
    request.clarification = CLARIFICATION_QUESTION
    setStatus(request, 'REVIEWING', 'AI 분석')
    return
  }
  request.clarification = null
  request.plan = analyzePrompt(prompt, request.id, project, request.requester)
  request.currentPlanId = request.plan.id
  setStatus(request, 'REVIEWING', 'AI 분석')
}

export function retryAnalysis(request: StoredRequest, user: StoredUser) {
  assertRequester(request, user)
  assertStatus(request, ['ANALYSIS_FAILED'])
  if (request.analysisAttempts >= MAX_ANALYSIS_ATTEMPTS) {
    throw new HttpError(409, 'RETRY_LIMIT', '분석 재시도 횟수를 넘었습니다')
  }
  request.analysisAttempts += 1
  request.pendingAnalysis = { kind: 'NEW' }
  setStatus(request, 'ANALYZING', user.name)
  scheduleAnalysis(request.id)
}

export function patchPlan(
  request: StoredRequest,
  user: StoredUser,
  body: { basePlanId?: string; changes?: PlanChange[]; answer?: string },
) {
  assertRequester(request, user)
  assertStatus(request, ['REVIEWING', 'PENDING_APPROVAL', 'PARTIALLY_COMPLETED'])
  // 서버는 답변일 때도 basePlanId를 현재 Plan과 비교한다 (RequestPlanService.patchPlan).
  if ((body.basePlanId ?? null) !== request.currentPlanId) {
    throw new HttpError(409, 'INVALID_STATE', '현재 Plan이 아닙니다')
  }
  if (body.answer !== undefined) {
    if (!request.clarification) throw new HttpError(409, 'INVALID_STATE', 'AI 확인 질문이 없습니다')
    request.pendingAnalysis = { kind: 'ANSWER', answer: body.answer }
  } else {
    request.pendingAnalysis = {
      kind: 'PATCH',
      changes: body.changes ?? [],
      returnStatus: request.status === 'REVIEWING' ? 'REVIEWING' : 'REAPPROVAL_REQUIRED',
    }
  }
  setStatus(request, 'ANALYZING', user.name)
  audit(user, 'PLAN_UPDATED', { requestId: request.id }, { changes: body.changes ?? [], answer: body.answer })
  scheduleAnalysis(request.id)
}

function applyPlanChanges(
  request: StoredRequest,
  changes: PlanChange[],
  returnStatus: 'REVIEWING' | 'REAPPROVAL_REQUIRED',
) {
  const previous = request.plan as Plan
  const project = requireProject(request.projectId)
  const changedIds: string[] = []
  const removedTitles: string[] = []
  const tasks: Task[] = []

  for (const task of previous.tasks) {
    const change = changes.find((c) => c.taskId === task.id)
    if (change?.op === 'DELETE') {
      removedTitles.push(task.title)
      continue
    }
    if (change?.op === 'UPDATE' && change.instruction) {
      tasks.push(applyInstruction(task, change.instruction, project, request.requester))
      changedIds.push(task.id)
    } else {
      tasks.push({ ...task })
    }
  }
  const nextTasks = tasks.map((task, index) => ({
    ...task,
    order: index + 1,
    // 재승인: 이미 성공한 작업은 그대로 두고, 나머지는 승인을 처음부터 다시 받는다.
    status: (task.status === 'BLOCKED' || task.status === 'SUCCEEDED' ? task.status : 'PENDING') as Task['status'],
  }))

  archivePlan(request)
  request.plan = makePlan(request.id, project, nextTasks, previous.kind)
  request.currentPlanId = request.plan.id
  request.approvals = []
  request.approvalRecords = []
  request.changedTaskIds = returnStatus === 'REAPPROVAL_REQUIRED' ? changedIds : []
  request.removedTaskTitles = returnStatus === 'REAPPROVAL_REQUIRED' ? removedTitles : []
  setStatus(request, returnStatus, 'AI 분석')
}

// ── 제출·승인·거부 ─────────────────────────────────────────

function submitResponse(request: StoredRequest): SubmitResponse {
  const plan = request.plan as Plan
  return {
    id: request.id,
    status: request.status,
    planId: plan.id,
    planHash: plan.planHash as string,
    // 서버와 같은 규칙: 금지가 아니고 누구나 승인이거나 요청자가 후보에 있으면 담는다. 무엇을 바로 서명할지는 화면이 더 좁게 정한다.
    selfApprovableTaskIds: plan.tasks
      .filter(
        (t) =>
          t.risk !== 'FORBIDDEN' &&
          t.requiredApprovers.some((r) => r.rule === 'ANYONE' || r.candidates?.includes(request.requester.id)),
      )
      .map((t) => t.id),
  }
}

function notifyApprovers(request: StoredRequest) {
  const plan = request.plan as Plan
  const ids = plan.tasks
    .filter((t) => t.status === 'PENDING')
    .flatMap((t) => t.requiredApprovers.flatMap((r) => r.candidates ?? []))
  notify(
    ids,
    `승인 요청이 도착했습니다: ${request.prompt.slice(0, 30)}`,
    `/approvals/${request.id}`,
    'approvalRequests',
  )
}

/** 제출 단계에서는 웹쉘을 호출하지 않는다. 표시용 해시는 웹 서비스가 2.3 규칙으로 만든다 (명세 4.3). */
export function submitRequest(request: StoredRequest, user: StoredUser): SubmitResponse {
  assertRequester(request, user)
  assertStatus(request, ['REVIEWING', 'REAPPROVAL_REQUIRED', 'VERIFICATION_FAILED'])
  const plan = request.plan
  if (!plan || request.clarification) throw new HttpError(409, 'INVALID_STATE', 'Plan이 아직 없습니다')
  if (plan.tasks.every((t) => t.status === 'BLOCKED') || plan.tasks.length === 0) {
    throw new HttpError(422, 'FORBIDDEN_TASK', '금지 작업만 남아 있습니다')
  }
  // 부분완료에서 실패 작업을 모두 지웠다면 승인받을 작업이 없다. 승인대기에 멈추지 않고 그대로 끝낸다.
  if (plan.tasks.every((t) => t.status === 'BLOCKED' || t.status === 'SUCCEEDED')) {
    plan.planHash = hashService.computePlanHash(plan, request.projectId)
    recordSubmission(request)
    setStatus(request, 'COMPLETED', user.name)
    audit(user, 'SUBMITTED', { requestId: request.id }, { planHash: plan.planHash, nothingLeft: true })
    return submitResponse(request)
  }
  const project = requireProject(request.projectId)
  for (const task of plan.tasks) {
    task.requiredApprovers = buildRequiredApprovers(project, request.requester, task.type, task.risk)
    if (task.status !== 'BLOCKED' && task.status !== 'SUCCEEDED') task.status = 'PENDING'
  }
  request.approvals = []
  request.approvalRecords = []
  request.failedChecks = []
  request.forgedHashTarget = undefined
  plan.planHash = hashService.computePlanHash(plan, request.projectId)
  request.submittedAt = nowIso()
  recordSubmission(request, request.submittedAt)
  setStatus(request, 'PENDING_APPROVAL', user.name)
  audit(user, 'SUBMITTED', { requestId: request.id }, { planHash: plan.planHash })
  notifyApprovers(request)
  return submitResponse(request)
}

export function approvalContext(
  request: StoredRequest,
  user: StoredUser,
  network: 'INTERNAL' | 'EXTERNAL',
): ApprovalContext {
  // 서버는 볼 수 있는 요청이면 제출 전이든 승인권자가 아니든 승인 자료를 준다 (ApprovalService.approvalContext).
  const plan = request.plan
  if (!plan) throw new HttpError(409, 'INVALID_STATE', '아직 Plan이 없습니다')
  const open = request.status === 'PENDING_APPROVAL'
  const eligible = open ? plan.tasks.filter((t) => t.status === 'PENDING' && matchRequirement(user, t, request)) : []
  const blocked = network === 'EXTERNAL' ? eligible.filter((t) => !isExternallyApprovable(t)) : []
  return {
    requestId: request.id,
    plan,
    planHash: plan.planHash ?? hashService.computePlanHash(plan, request.projectId),
    hashTarget: request.forgedHashTarget ?? toHashTarget(plan, request.projectId),
    approvableTaskIds: eligible.filter((t) => !blocked.includes(t)).map((t) => t.id),
    blockedTaskIds: blocked.map((t) => t.id),
    blockedReason: blocked.length ? 'INTERNAL_NETWORK_ONLY' : null,
    network,
  }
}

export function submitApproval(
  request: StoredRequest,
  user: StoredUser,
  network: 'INTERNAL' | 'EXTERNAL',
  body: { planId: string; planHash: string; taskIds: string[]; keyId: string; envelope: ApprovalEnvelope },
): SubmitApprovalResponse {
  assertStatus(request, ['PENDING_APPROVAL'])
  const plan = request.plan as Plan
  if (body.planId !== plan.id || body.planHash !== plan.planHash) {
    throw new HttpError(409, 'PLAN_HASH_MISMATCH', '서명하려는 해시가 현재 Plan 해시와 다릅니다')
  }
  const tasks = body.taskIds.map((id) => plan.tasks.find((t) => t.id === id))
  if (tasks.length === 0 || tasks.some((t) => !t)) {
    throw new HttpError(400, 'VALIDATION_ERROR', '승인할 작업이 올바르지 않습니다')
  }
  if (network === 'EXTERNAL' && tasks.some((t) => !isExternallyApprovable(t as Task))) {
    throw new HttpError(403, 'INTERNAL_NETWORK_ONLY', '내부망에서만 가능한 기능입니다')
  }
  const matched = (tasks as Task[]).map((task) => {
    const requirement = task.status === 'PENDING' ? matchRequirement(user, task, request) : null
    if (!requirement) throw new HttpError(403, 'NOT_APPROVER', '이 작업의 승인권자가 아닙니다')
    return { task, requirement }
  })
  const key = db().signingKeys.find((k) => k.id === body.keyId && k.userId === user.id)
  if (key?.status !== 'REGISTERED') {
    throw new HttpError(403, 'KEY_NOT_REGISTERED', '승인 키가 등록되지 않았습니다')
  }

  const at = nowIso()
  const recordId = crypto.randomUUID()
  request.approvalRecords.push({
    id: recordId,
    requestId: request.id,
    planId: plan.id,
    planHash: body.planHash,
    taskIds: body.taskIds,
    approverId: user.id,
    keyId: body.keyId,
    network,
    envelope: body.envelope,
    createdAt: at,
  })
  for (const { task, requirement } of matched) {
    request.approvals.push({
      id: recordId,
      planId: plan.id,
      taskId: task.id,
      rule: requirement.rule,
      userId: user.id,
      name: user.name,
      network,
      at,
      self: user.id === request.requester.id,
    })
    if (isTaskFullyApproved(task, request)) task.status = 'APPROVED'
  }
  audit(user, 'APPROVAL_SUBMITTED', { requestId: request.id, taskIds: body.taskIds }, { keyId: body.keyId })
  request.updatedAt = at

  const remaining = plan.tasks.filter((t) => t.status === 'PENDING').map((t) => t.id)
  const approved = plan.tasks.filter((t) => t.status === 'APPROVED').map((t) => t.id)
  // 웹쉘에 연결할 수 없으면 false가 되고, 상태는 PENDING_APPROVAL로 남아 웹 서비스가 다시 시도한다 (명세 4.5).
  const executionRequested = remaining.length === 0 && requestExecution(request)
  return {
    requestId: request.id,
    status: request.status,
    approvedTaskIds: approved,
    remainingTaskIds: remaining,
    executionRequested,
  }
}

export function rejectRequest(
  request: StoredRequest,
  user: StoredUser,
  network: 'INTERNAL' | 'EXTERNAL',
  body: RejectBody,
) {
  assertStatus(request, ['PENDING_APPROVAL'])
  const plan = request.plan as Plan
  if (!body.planId) throw new HttpError(400, 'VALIDATION_ERROR', 'planId가 필요합니다')
  if (body.planId !== plan.id) throw new HttpError(409, 'INVALID_STATE', '현재 Plan이 아닙니다')
  const reason = body.reason?.trim() ?? ''
  const tasks = plan.tasks.filter((t) => body.taskIds.includes(t.id))
  if (tasks.length === 0) throw new HttpError(400, 'VALIDATION_ERROR', '거부할 작업을 고르세요')
  if (network === 'EXTERNAL' && tasks.some((t) => !isExternallyApprovable(t))) {
    throw new HttpError(403, 'INTERNAL_NETWORK_ONLY', '내부망에서만 가능한 기능입니다')
  }
  if (tasks.some((t) => !matchRequirement(user, t, request))) {
    throw new HttpError(403, 'NOT_APPROVER', '이 작업의 승인권자가 아닙니다')
  }
  for (const task of tasks) task.status = 'REJECTED'
  request.rejection = { by: user.name, reason, at: nowIso(), taskIds: body.taskIds }
  setStatus(request, 'REJECTED', user.name)
  audit(user, 'REJECTED', { requestId: request.id, taskIds: body.taskIds }, { reason })
  notify(
    [request.requester.id],
    `요청이 거부되었습니다: ${request.prompt.slice(0, 30)}`,
    `/requests/${request.id}`,
    'requestResults',
  )
}

export function cancelRequest(request: StoredRequest, user: StoredUser) {
  assertRequester(request, user)
  assertStatus(request, ['REVIEWING', 'PENDING_APPROVAL', 'REAPPROVAL_REQUIRED', 'VERIFICATION_FAILED'])
  setStatus(request, 'CANCELED', user.name)
  audit(user, 'REQUEST_CANCELED', { requestId: request.id })
}

// ── 킬 스위치·재시도·롤백 ──────────────────────────────────

function canKill(request: StoredRequest, user: StoredUser): boolean {
  if (user.role === 'ADMIN') return true
  const project = requireProject(request.projectId)
  if (user.role === 'DEPT_MANAGER' && user.departmentId === project.departmentId) return true
  return request.requester.id === user.id || request.approvals.some((a) => a.userId === user.id)
}

export function killRequest(request: StoredRequest, user: StoredUser, reason: string) {
  assertStatus(request, ['RUNNING'])
  if (!canKill(request, user)) throw new HttpError(403, 'FORBIDDEN_ROLE', '중단 권한이 없습니다')
  assertWebshellReachable()
  const plan = request.plan as Plan
  const skipped: string[] = []
  for (const task of plan.tasks) {
    if (['APPROVED', 'PENDING', 'RUNNING'].includes(task.status)) {
      task.status = 'SKIPPED'
      skipped.push(task.id)
    }
  }
  request.kill = { by: user.name, reason, at: nowIso() }
  setStatus(request, 'KILLED', user.name)
  audit(user, 'KILLED', { requestId: request.id, taskIds: skipped }, { reason })
  reportFinalStatus(request)
  endLogs(request.id)
  return { id: request.id, status: request.status, skippedTaskIds: skipped }
}

/** 서버처럼 실패·건너뛴 작업만 새 Plan으로 옮기고 새 해시를 낸다 (RequestPlanService.retryFailedTasks). 본인 승인 목록은 주지 않는다. */
export function retryFailedTasks(request: StoredRequest, user: StoredUser): PlanRetryResponse {
  assertRequester(request, user)
  assertStatus(request, ['PARTIALLY_COMPLETED'])
  const previous = request.plan as Plan
  const project = requireProject(request.projectId)
  const retryable = previous.tasks.filter((task) => task.status === 'FAILED' || task.status === 'SKIPPED')
  if (retryable.length === 0) throw new HttpError(409, 'INVALID_STATE', '재시도할 작업이 없습니다')
  const tasks = retryable.map((task) => ({
    ...task,
    status: 'PENDING' as const,
    requiredApprovers: buildRequiredApprovers(project, request.requester, task.type, task.risk),
  }))
  archivePlan(request)
  request.plan = makePlan(request.id, project, tasks, previous.kind)
  request.currentPlanId = request.plan.id
  request.approvals = []
  request.approvalRecords = []
  // 재시도 프롬프트에는 강제 실패 키워드를 남기지 않아 두 번째 실행은 성공한다.
  request.prompt = request.prompt.replace('#실행실패', '').trim()
  request.plan.planHash = hashService.computePlanHash(request.plan, request.projectId)
  request.submittedAt = nowIso()
  setStatus(request, 'PENDING_APPROVAL', user.name)
  audit(user, 'SUBMITTED', { requestId: request.id }, { retry: true, planHash: request.plan.planHash })
  notifyApprovers(request)
  return { id: request.id, status: request.status, planId: request.plan.id, planHash: request.plan.planHash }
}

export function requestRollback(
  request: StoredRequest,
  user: StoredUser,
  body: { documentId: string; version: number },
): SubmitResponse {
  assertStatus(request, ['COMPLETED', 'PARTIALLY_COMPLETED', 'KILLED', 'ROLLBACK_FAILED'])
  const database = db()
  const hasDocTask = request.plan?.tasks.some((t) => t.type === 'DOC')
  const document = database.documents.find((d) => d.id === body.documentId)
  if (!hasDocTask || !document) {
    throw new HttpError(400, 'VALIDATION_ERROR', '문서 작업이 아니어서 되돌릴 수 없습니다')
  }
  const version = database.docVersions.find((v) => v.documentId === document.id && v.version === body.version)
  if (!version) throw new HttpError(404, 'NOT_FOUND', '해당 문서 버전이 없습니다')
  if (request.requester.id !== user.id && !isCandidate(user, request)) {
    throw new HttpError(403, 'FORBIDDEN_ROLE', '롤백 권한이 없습니다')
  }
  const project = requireProject(request.projectId)
  const task = toTask(
    {
      type: 'DOC',
      title: `문서 롤백: ${document.title} v${document.currentVersion} → v${version.version}`,
      description: '적용된 문서를 이전 버전으로 되돌립니다.',
      target: document.path,
      content: { body: version.body },
    },
    1,
    project,
    request.requester,
  )
  // 제출과 같다 (명세 4.2): 금지 작업만 있는 Plan은 승인대기로 보내지 않는다.
  if (task.status === 'BLOCKED') throw new HttpError(422, 'FORBIDDEN_TASK', '금지 작업이라 이 문서를 되돌릴 수 없습니다')
  // TODO(spec): 롤백 Plan이 같은 요청에 붙는지 새 요청인지 명세가 갈린다(source: ROLLBACK vs 상태 흐름표).
  // 상태 흐름표를 따라 같은 요청에서 PENDING_APPROVAL → ROLLING_BACK으로 진행한다.
  archivePlan(request)
  request.plan = makePlan(request.id, project, [task], 'ROLLBACK')
  request.currentPlanId = request.plan.id
  request.approvals = []
  request.approvalRecords = []
  request.rollback = body
  request.plan.planHash = hashService.computePlanHash(request.plan, request.projectId)
  request.submittedAt = nowIso()
  setStatus(request, 'PENDING_APPROVAL', user.name)
  audit(user, 'ROLLBACK_REQUESTED', { requestId: request.id, taskIds: [task.id] }, { ...body })
  notifyApprovers(request)
  return submitResponse(request)
}

/** 담당자 변경 (5.8): 빠진 담당자의 서명이 필요한 승인 대기 작업은 재승인필요로 바뀐다. */
export function reapproveAfterOwnerChange(projectId: string, removedIds: string[], actorName: string) {
  if (removedIds.length === 0) return
  for (const request of db().requests) {
    if (request.projectId !== projectId || request.status !== 'PENDING_APPROVAL' || !request.plan) continue
    const affected = request.plan.tasks.filter((task) =>
      task.requiredApprovers.some(
        (r) => r.rule === 'PROJECT_OWNER' && r.candidates?.some((id) => removedIds.includes(id)),
      ),
    )
    if (affected.length === 0) continue
    request.changedTaskIds = affected.map((t) => t.id)
    request.removedTaskTitles = []
    request.approvals = []
    request.approvalRecords = []
    setStatus(request, 'REAPPROVAL_REQUIRED', actorName)
  }
}

export function killAll(user: StoredUser, reason: string) {
  assertWebshellReachable()
  const running = db().requests.filter((r) => r.status === 'RUNNING')
  return running.map((request) => {
    killRequest(request, user, reason)
    return request.id
  })
}

/** 저장된 DB를 다시 불러왔을 때 멈춰 있던 타이머를 살린다. */
export function resumeTimers() {
  for (const request of db().requests) {
    if (request.frozen) continue
    if (request.status === 'ANALYZING') scheduleAnalysis(request.id)
    if (request.status === 'RUNNING' || request.status === 'ROLLING_BACK') scheduleExecution(request.id)
    if (isAwaitingExecution(request)) scheduleExecutionRetry(request.id)
  }
  resumeAuditExports()
}

export function taskDocument(request: StoredRequest, taskId: string) {
  const task = request.plan?.tasks.find((t) => t.id === taskId)
  if (!task) throw new HttpError(404, 'NOT_FOUND', '작업을 찾을 수 없습니다')
  if (task.type !== 'DOC') throw new HttpError(400, 'VALIDATION_ERROR', '문서 작업이 아닙니다')
  const database = db()
  const document = database.documents.find((d) => d.projectId === request.projectId && d.path === task.target)
  const current = document
    ? database.docVersions.find((v) => v.documentId === document.id && v.version === document.currentVersion)
    : undefined
  const currentBody = current?.body ?? ''
  const proposedBody = task.content.body ?? ''
  return {
    documentId: document?.id ?? null,
    title: document?.title ?? task.target,
    currentVersion: document?.currentVersion ?? null,
    currentBody,
    proposedBody,
    diff: makeUnifiedDiff(task.target, currentBody, proposedBody),
  }
}
