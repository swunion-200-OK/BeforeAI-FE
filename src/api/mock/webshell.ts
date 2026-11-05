/**
 * 웹쉘 흉내 (API 명세 5장). 명세상 웹쉘은 웹 서비스를 믿지 않으므로,
 * 여기서도 서비스가 평문으로 기록한 승인 내역은 보지 않고 서명과 웹쉘 정책만으로 판단한다.
 * 개인키와 1회용 ID 사용 기록은 이 파일과 db().webshell 밖으로 나가지 않는다.
 */
import { ed25519, x25519 } from '@noble/curves/ed25519.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { cryptoService } from '../../crypto/cryptoService'
import { bytesToBase64 } from '../../crypto/encoding'
import { canonicalize, hashService, toHashTarget } from '../../crypto/hashService'
import { signingService } from '../../crypto/signingService'
import type {
  ApprovalEnvelope,
  ApproverRule,
  ExecutionRequestBody,
  FailedCheck,
  LogLine,
  Plan,
  RequestStatus,
  SignedApproval,
  StepStatus,
  Task,
  TaskContent,
  TaskStatus,
  TaskType,
  WebshellEvent,
  WebshellExecution,
  WebshellPublicKey,
  WebshellStep,
} from '../types'
import { hitsForbiddenTarget, qualifies, requiredRules } from './policy'
import {
  HttpError,
  SYSTEM_ACTOR,
  appendLog,
  audit,
  db,
  endLogs,
  generation,
  mockConfig,
  nowIso,
  notify,
  persist,
  requireProject,
  setStatus,
  type StoredRequest,
  type StoredUser,
} from './store'

const encoder = new TextEncoder()
const derive = (seed: string) => sha256(encoder.encode(seed))

const SIGNING_SECRET = derive('beforeai-mock-webshell-signing-key')
const ENCRYPTION_SECRET = derive('beforeai-mock-webshell-encryption-key')

const encryptionPublic = x25519.getPublicKey(ENCRYPTION_SECRET)
const signingPublic = ed25519.getPublicKey(SIGNING_SECRET)

const keyInfo = (algorithm: string, publicKey: Uint8Array) => ({
  algorithm,
  publicKey: bytesToBase64(publicKey),
  fingerprint: `sha256:${bytesToHex(sha256(publicKey))}`,
})

export const WEBSHELL_PUBLIC_KEY: WebshellPublicKey = {
  encryption: keyInfo('X25519', encryptionPublic),
  signing: keyInfo('Ed25519', signingPublic),
}

/** 승인 봉투를 웹쉘 개인키로 연다. 개인키 대신 이 함수만 밖으로 내보낸다. */
export function openEnvelope(envelope: ApprovalEnvelope): SignedApproval {
  return cryptoService.decryptForWebshell(envelope, ENCRYPTION_SECRET)
}

/** 실행 결과·로그·콜백에 붙이는 웹쉘 서명: base64(Ed25519(JCS(value))) */
function webshellSign(value: unknown): string {
  return bytesToBase64(ed25519.sign(encoder.encode(canonicalize(value)), SIGNING_SECRET))
}

export function signLogLine(requestId: string, line: Omit<LogLine, 'webshellSignature'>): LogLine {
  return { ...line, webshellSignature: webshellSign({ requestId, ...line }) }
}

function webshellLog(requestId: string, taskId: string | null, message: string): number {
  const sequence = (db().logs[requestId]?.length ?? 0) + 1
  appendLog(requestId, signLogLine(requestId, { sequence, at: nowIso(), taskId, message }))
  return sequence
}

export function signedExecution(request: StoredRequest, executionId: string): WebshellExecution {
  const plan = request.plan as Plan
  const unsigned = {
    executionId,
    planHash: hashService.computePlanHash(plan, request.projectId),
    status: request.status,
    taskResults: plan.tasks.map((task) => ({ taskId: task.id, status: task.status })),
  }
  return { ...unsigned, webshellSignature: webshellSign(unsigned) }
}

/** 웹쉘 → 웹 서비스 콜백. 이벤트마다 웹쉘 서명을 붙인다 (명세 5장). */
function emitEvent(
  request: StoredRequest,
  event: Pick<WebshellEvent, 'type' | 'taskId' | 'status' | 'failedChecks' | 'step'>,
  at = nowIso(),
) {
  const unsigned = {
    ...event,
    requestId: request.id,
    executionId: request.execution?.executionId ?? null,
    at,
  }
  request.webshellEvents.push({ ...unsigned, webshellSignature: webshellSign(unsigned) })
}

/**
 * 실행 단계의 시작과 결과를 알린다. 진행 상황 트리의 STEP 노드는 이 이벤트로만 만든다 (기능 명세서 5.12).
 * TODO(spec): 명세에는 "단계별 진행(시작·성공·실패·건너뜀)"만 있고 콜백 모양이 없다.
 * 스크립트가 `$ 명령` 줄에 닿을 때 시작을, 다음 단계나 작업 끝에서 결과를 보내고 구간은 로그 sequence로 적는다.
 */
export function emitStepEvent(request: StoredRequest, taskId: string | undefined, step: WebshellStep, at?: string) {
  emitEvent(request, { type: 'STEP', taskId, step }, at)
}

/** 아직 열려 있는 단계를 지금까지의 로그 구간으로 끝낸다. */
function closeSteps(request: StoredRequest, status: Exclude<StepStatus, 'RUNNING'>) {
  const latest = new Map<string, WebshellEvent>()
  for (const event of request.webshellEvents) {
    if (event.step) latest.set(event.step.id, event)
  }
  const to = db().logs[request.id]?.length ?? 0
  for (const { taskId, step } of latest.values()) {
    if (step?.status === 'RUNNING') {
      emitStepEvent(request, taskId, { ...step, status, logRange: { from: step.logRange.from, to } })
    }
  }
}

/** 최종 상태를 서명해 알린다. 킬 스위치로 끝날 때도 같다. */
export function reportFinalStatus(request: StoredRequest) {
  // 실행이 끝나면 전용 세션도 닫는다. 다시 실행하려면 새 검증이 필요하다.
  delete db().webshell.sessions[request.id]
  closeSteps(request, 'SKIPPED')
  request.execution = signedExecution(request, request.execution?.executionId ?? crypto.randomUUID())
  emitEvent(request, { type: 'FINAL_STATUS', status: request.status })
}

/** 킬 스위치처럼 웹쉘에 바로 닿아야 하는 동작은 연결할 수 없으면 502다 (명세 4.6). */
export function assertWebshellReachable() {
  if (!mockConfig.webshellReachable) throw new HttpError(502, 'WEBSHELL_UNAVAILABLE', '웹쉘에 연결할 수 없습니다')
}

// ── 실행 직전 검증 (API 명세 5.1, 기능 명세서 5.9 ④) ───────

/**
 * TODO(spec): 실행 요청 본문(해시 대상)에는 작업 상태가 없어, 금지·이미 성공한 작업을 건너뛰는 근거가 명세에 없다.
 * 목에서는 서비스의 작업 상태를 쓴다. 검증과 실행이 이 목록을 함께 쓰므로, 검증을 건너뛴 작업은 실행되지 않는다.
 */
const WILL_RUN: TaskStatus[] = ['APPROVED', 'RUNNING', 'PENDING']

/** 유형별 내용 (API 명세 2.2): diff(코드) · command(배포) · query(DB·데이터) · body(문서) */
const CONTENT_OF_TYPE: Record<TaskType, keyof TaskContent> = {
  CODE_MINOR: 'diff',
  CODE_FEATURE: 'diff',
  DEPLOY: 'command',
  DB: 'query',
  DATA_READ: 'query',
  DATA_WRITE: 'query',
  DOC: 'body',
}

export function contentFitsType(task: Pick<Task, 'type' | 'content'>): boolean {
  return Object.entries(task.content).every(([key, value]) => value === undefined || key === CONTENT_OF_TYPE[task.type])
}

/** 규칙마다 서로 다른 한 사람이 서명해야 한다 (기능 명세서 5.5의 담당자 + 부서 관리자). */
function everyRuleHasOwnSigner(
  rules: ApproverRule[],
  signers: StoredUser[],
  scope: Pick<StoredRequest, 'projectId' | 'requester'>,
): boolean {
  const [rule, ...rest] = rules
  if (!rule) return true
  return signers.some(
    (user) =>
      qualifies(user, rule, scope) &&
      everyRuleHasOwnSigner(
        rest,
        signers.filter((other) => other.id !== user.id),
        scope,
      ),
  )
}

export interface VerificationResult {
  failed: FailedCheck[]
  forbiddenTaskIds: string[]
  /** 검증을 통과하면 전용 세션에서 실행할 작업 */
  taskIds: string[]
  /** 서명 단위 검사에서 처음 실패한 키 */
  keyId?: string
}

export function verifyExecution(body: ExecutionRequestBody, request: StoredRequest): VerificationResult {
  const database = db()
  const { usedNonces, policy } = database.webshell
  const failed = new Set<FailedCheck>()
  const forbiddenTaskIds: string[] = []
  let failedKeyId: string | undefined

  const recomputed = hashService.computeTargetHash(body.plan)
  const nonces: string[] = []
  const signers: Array<{ userId: string; taskIds: string[] }> = []

  for (const { keyId, envelope } of body.approvals) {
    const fail = (check: FailedCheck) => {
      failed.add(check)
      failedKeyId ??= keyId
    }
    let signed: SignedApproval
    try {
      signed = openEnvelope(envelope)
    } catch {
      fail('DECRYPT_FAILED')
      continue
    }
    const { payload } = signed
    if (payload.planHash !== recomputed) fail('PLAN_HASH_MISMATCH')
    // 봉투 밖의 평문 keyId는 믿지 않고 서명된 값을 쓴다.
    const key = policy.keys.find((k) => k.keyId === payload.keyId)
    if (!key) {
      fail('KEY_NOT_REGISTERED')
      continue
    }
    if (!signingService.verifyApproval(signed, key.publicKey) || key.userId !== payload.approverId) {
      fail('SIGNATURE_INVALID')
      continue
    }
    if (usedNonces.includes(payload.nonce) || nonces.includes(payload.nonce)) {
      fail('NONCE_ALREADY_USED')
      continue
    }
    nonces.push(payload.nonce)
    signers.push({ userId: payload.approverId, taskIds: payload.taskIds })
  }

  const project = requireProject(body.plan.projectId)
  // 담당자는 서명으로 확인한 Plan의 프로젝트로 판단한다.
  // TODO(spec): 요청자는 해시 대상이 아니고, 웹쉘 정책에 승인자의 역할·부서·담당 관계를 담는 방법도 명세에 없어 목에서는 서비스 값을 같이 쓴다.
  const scope = { projectId: body.plan.projectId, requester: request.requester }
  const taskIds: string[] = []
  for (const task of body.plan.tasks) {
    const stored = request.plan?.tasks.find((t) => t.id === task.id)
    if (!stored || !WILL_RUN.includes(stored.status)) continue
    taskIds.push(task.id)
    // 서비스가 정한 requiredApprovers는 해시 대상이 아니므로 쓰지 않고, 해시로 확인한 유형·위험도와 웹쉘 정책으로 다시 정한다.
    const taskSigners = database.users.filter((user) =>
      signers.some((signer) => signer.userId === user.id && signer.taskIds.includes(task.id)),
    )
    if (!everyRuleHasOwnSigner(requiredRules(task.type, task.risk, policy.preset, policy.matrix), taskSigners, scope)) {
      failed.add('MISSING_REQUIRED_APPROVER')
    }
    // TODO(spec): 연관 부서는 해시 대상이 아니라 웹쉘이 스스로 알 수 없다. 넓게 막도록 서비스 값도 함께 본다.
    const departments = [project.departmentId, ...(stored?.relatedDepartments ?? [])]
    const hitsPolicyRule = policy.forbiddenRules.some(
      (rule) =>
        departments.includes(rule.departmentId) &&
        rule.taskType === task.type &&
        hitsForbiddenTarget(rule.target, task.target, task.content),
    )
    // TODO(spec): 유형과 내용이 어긋난 작업의 실패 코드가 명세에 없어 금지 작업으로 막는다.
    if (hitsPolicyRule || task.risk === 'FORBIDDEN' || !contentFitsType(task)) {
      failed.add('FORBIDDEN_TASK')
      forbiddenTaskIds.push(task.id)
    }
  }
  // 실행할 작업이 없으면 서명으로 확인할 것도 없다. 빈 실행을 성공으로 끝내지 않는다.
  if (taskIds.length === 0) failed.add('MISSING_REQUIRED_APPROVER')

  // 통과하면 1회용 ID를 한 번에 소진한다. 같은 서명으로 요청이 두 번 와도 하나만 통과한다.
  if (failed.size === 0) usedNonces.push(...nonces)
  return { failed: [...failed], forbiddenTaskIds, taskIds, keyId: failedKeyId }
}

/** 승인이 다 모였지만 아직 실행을 요청하지 못한 상태 */
export function isAwaitingExecution(request: StoredRequest): boolean {
  const tasks = request.plan?.tasks ?? []
  return request.status === 'PENDING_APPROVAL' && tasks.every((t) => t.status !== 'PENDING') && tasks.some((t) => t.status === 'APPROVED')
}

export function scheduleExecutionRetry(requestId: string) {
  const startedGeneration = generation
  setTimeout(() => {
    if (startedGeneration !== generation) return
    const request = db().requests.find((r) => r.id === requestId)
    if (!request || !isAwaitingExecution(request)) return
    requestExecution(request)
    persist()
  }, mockConfig.webshellRetryMs)
}

/**
 * 필요한 승인이 다 모이면 웹 서비스가 호출한다 (명세 5.1).
 * 웹쉘에 연결할 수 없으면 false를 돌려주고 다시 시도한다. 검증에 실패해도 요청은 한 것이므로 true다.
 */
export function requestExecution(request: StoredRequest): boolean {
  if (!mockConfig.webshellReachable) {
    scheduleExecutionRetry(request.id)
    return false
  }
  const plan = request.plan as Plan
  // 변조 시연 전용 (tamperDemo.ts): 서명은 이미 제출됐고 웹쉘이 검증하기 바로 전이다. 아래 검증은 평소와 똑같이 돈다.
  if (request.armedPlanSwap) {
    const { taskId, target, content } = request.armedPlanSwap
    plan.tasks = plan.tasks.map((task) => (task.id === taskId ? { ...task, target, content } : task))
    delete request.armedPlanSwap
  }
  const { failed, forbiddenTaskIds, taskIds, keyId } = verifyExecution(
    {
      plan: toHashTarget(plan, request.projectId),
      approvals: request.approvalRecords
        .filter((record) => record.planId === plan.id)
        .map((record) => ({ keyId: record.keyId, envelope: record.envelope })),
    },
    request,
  )
  if (failed.length > 0) {
    request.failedChecks = failed
    for (const task of plan.tasks) {
      if (forbiddenTaskIds.includes(task.id)) task.status = 'FAILED'
    }
    setStatus(request, 'VERIFICATION_FAILED', SYSTEM_ACTOR.name)
    audit(SYSTEM_ACTOR, 'VERIFICATION_FAILED', { requestId: request.id }, { failedChecks: failed, ...(keyId ? { keyId } : {}) })
    emitEvent(request, { type: 'VERIFICATION_FAILED', failedChecks: failed })
    const database = db()
    const project = requireProject(request.projectId)
    const alertTargets = database.users.filter(
      (u) => u.role === 'ADMIN' || (u.role === 'DEPT_MANAGER' && u.departmentId === project.departmentId),
    )
    notify(
      alertTargets.map((u) => u.id),
      `승인 서명 검증에 실패했습니다: ${request.prompt.slice(0, 30)}`,
      `/requests/${request.id}`,
    )
    return true
  }
  // 검증한 작업을 세션에 고정한다. 그 뒤 서비스 쪽 작업 상태가 바뀌어도 다른 작업은 실행하지 않는다.
  db().webshell.sessions[request.id] = taskIds
  const rollingBack = plan.kind === 'ROLLBACK'
  setStatus(request, rollingBack ? 'ROLLING_BACK' : 'RUNNING', SYSTEM_ACTOR.name)
  request.execution = signedExecution(request, crypto.randomUUID())
  audit(SYSTEM_ACTOR, 'EXECUTION_STARTED', { requestId: request.id, taskIds: plan.tasks.map((t) => t.id) })
  webshellLog(request.id, null, '[웹쉘] 승인 서명 검증 통과. 1회용 ID 소진, 전용 세션을 엽니다')
  request.execLine = 0
  scheduleExecution(request.id)
  return true
}

// ── 실행 시뮬레이션 ────────────────────────────────────────

/** step이 있는 줄에서 새 실행 단계가 시작된다. */
type Line = { text: string; step?: string }

function scriptFor(task: Task, requestId: string): Line[] {
  const cmd = (text: string): Line => ({ text: `$ ${text}`, step: text })
  const info = (text: string): Line => ({ text })
  switch (task.type) {
    case 'CODE_MINOR':
    case 'CODE_FEATURE':
      return [
        cmd(`git switch -c ai/${requestId}`),
        cmd(`git apply ${task.target.replaceAll('/', '_')}.patch`),
        info(`1 file changed: ${task.target}`),
        cmd('npm test'),
        info('Tests  42 passed (42)'),
        cmd(`git push origin ai/${requestId}`),
      ]
    case 'DEPLOY':
      return [
        cmd(task.content.command ?? `./deploy.sh ${task.target}`),
        info('이미지 빌드 완료'),
        info(`${task.target} 롤아웃 1/3`),
        info(`${task.target} 롤아웃 2/3`),
        info(`${task.target} 롤아웃 3/3`),
        info('헬스 체크 통과'),
      ]
    case 'DB': {
      // 시드의 실행 중 요청은 시연하는 동안 끝나지 않게 길게 둔다 (약 20분).
      const steps = task.id === 't-long' ? 600 : 3
      return [
        cmd('npm run migrate:up'),
        ...Array.from({ length: steps }, (_, i) => info(`마이그레이션 진행 ${Math.round(((i + 1) / steps) * 100)}%`)),
        info('스키마 검증 통과'),
      ]
    }
    case 'DATA_READ':
    case 'DATA_WRITE':
      return [cmd(task.content.query ?? '-- query'), info('쿼리 실행 완료')]
    case 'DOC':
      // 문서 작업에는 `$ 명령` 줄이 없다. 트리에 빈 가지가 남지 않게 첫 줄을 단계로 본다.
      return [{ ...info(`문서 작성 완료: ${task.target}`), step: '문서 작성' }, info('문서 새 버전 저장')]
  }
}

function buildScript(request: StoredRequest): Array<Line & { taskId: string | null; endOf?: Task }> {
  const plan = request.plan as Plan
  const session = db().webshell.sessions[request.id]
  const script: Array<Line & { taskId: string | null; endOf?: Task }> = []
  for (const task of plan.tasks.filter((t) => session.includes(t.id) && WILL_RUN.includes(t.status))) {
    script.push({ text: `[${task.id}] ${task.title} 시작`, taskId: task.id })
    for (const line of scriptFor(task, request.id)) script.push({ ...line, taskId: task.id })
    script[script.length - 1].endOf = task
  }
  return script
}

export function scheduleExecution(requestId: string) {
  const startedGeneration = generation
  const tick = () => {
    if (startedGeneration !== generation) return
    const request = db().requests.find((r) => r.id === requestId)
    if (!request || (request.status !== 'RUNNING' && request.status !== 'ROLLING_BACK')) return
    // 검증을 거쳐 열린 세션이 없으면 웹쉘은 아무것도 실행하지 않는다.
    if (!db().webshell.sessions[request.id]) return
    const script = buildScript(request)
    const line = script[0]
    if (!line) {
      finish(request)
      persist()
      return
    }
    // 진행 위치는 작업별 시작 줄 수를 빼 둔 execLine으로 기억한다.
    const position = request.execLine ?? 0
    const taskLines = script.filter((l) => l.taskId === line.taskId)
    const current = taskLines[position]
    const task = (request.plan as Plan).tasks.find((t) => t.id === line.taskId) as Task
    if (task.status !== 'RUNNING') {
      task.status = 'RUNNING'
      emitEvent(request, { type: 'TASK_STARTED', taskId: task.id })
    }
    if (current.step) closeSteps(request, 'SUCCEEDED')
    const sequence = webshellLog(request.id, current.taskId, current.text)
    if (current.step) {
      emitStepEvent(request, task.id, {
        id: `s-${sequence}`,
        label: current.step,
        status: 'RUNNING',
        logRange: { from: sequence, to: null },
      })
    }
    if (current.endOf) {
      completeTask(request, task)
      request.execLine = 0
    } else {
      request.execLine = position + 1
    }
    persist()
    if (request.status === 'RUNNING' || request.status === 'ROLLING_BACK') {
      setTimeout(tick, request.execStepMs ?? mockConfig.execStepMs)
    }
  }
  setTimeout(tick, mockConfig.execStepMs)
}

function completeTask(request: StoredRequest, task: Task) {
  const plan = request.plan as Plan
  const shouldFail = request.prompt.includes('#실행실패') && task.order === Math.max(...plan.tasks.map((t) => t.order))
  if (shouldFail) {
    task.status = 'FAILED'
    webshellLog(request.id, task.id, `[${task.id}] 실패: 종료 코드 1`)
    closeSteps(request, 'FAILED')
    emitEvent(request, { type: 'TASK_FAILED', taskId: task.id })
    audit(SYSTEM_ACTOR, 'TASK_FAILED', { requestId: request.id, taskIds: [task.id] })
    finish(request)
    return
  }
  task.status = plan.kind === 'ROLLBACK' ? 'ROLLED_BACK' : 'SUCCEEDED'
  webshellLog(request.id, task.id, `[${task.id}] 성공`)
  closeSteps(request, 'SUCCEEDED')
  emitEvent(request, { type: 'TASK_SUCCEEDED', taskId: task.id })
  audit(SYSTEM_ACTOR, 'TASK_SUCCEEDED', { requestId: request.id, taskIds: [task.id] })
  applyEffects(request, task)
  const left = plan.tasks.some((t) => t.status === 'APPROVED' || t.status === 'PENDING')
  if (!left) finish(request)
}

function applyEffects(request: StoredRequest, task: Task) {
  const database = db()
  const project = requireProject(request.projectId)
  if (task.type === 'CODE_MINOR' || task.type === 'CODE_FEATURE') {
    project.baseCommit = bytesToHex(derive(`${project.baseCommit}:${task.id}:${Date.now()}`)).slice(0, 7)
  }
  if (task.type === 'DOC' && task.content.body !== undefined) {
    let document = database.documents.find((d) => d.projectId === project.id && d.path === task.target)
    if (!document) {
      document = {
        id: `doc-${database.documents.length + 1}`,
        projectId: project.id,
        title: task.target.split('/').pop() ?? task.target,
        path: task.target,
        currentVersion: 0,
        updatedAt: nowIso(),
      }
      database.documents.push(document)
    }
    document.currentVersion += 1
    document.updatedAt = nowIso()
    database.docVersions.push({
      documentId: document.id,
      version: document.currentVersion,
      body: task.content.body,
      createdAt: nowIso(),
      createdBy: { id: request.requester.id, name: request.requester.name },
      requestId: request.id,
    })
  }
}

function finish(request: StoredRequest) {
  const plan = request.plan as Plan
  const failedAt = plan.tasks.find((t) => t.status === 'FAILED')
  if (failedAt) {
    for (const task of plan.tasks) {
      if (task.status === 'APPROVED' || task.status === 'PENDING') task.status = 'SKIPPED'
    }
  }
  const succeeded = plan.tasks.filter((t) => t.status === 'SUCCEEDED' || t.status === 'ROLLED_BACK').length
  let final: RequestStatus
  if (plan.kind === 'ROLLBACK') final = failedAt ? 'ROLLBACK_FAILED' : 'ROLLED_BACK'
  else if (!failedAt) final = 'COMPLETED'
  else final = succeeded > 0 ? 'PARTIALLY_COMPLETED' : 'FAILED'

  webshellLog(request.id, null, '[웹쉘] 전용 세션을 닫습니다')
  setStatus(request, final, SYSTEM_ACTOR.name)
  reportFinalStatus(request)
  if (plan.kind === 'ROLLBACK') {
    audit(SYSTEM_ACTOR, final === 'ROLLED_BACK' ? 'ROLLBACK_SUCCEEDED' : 'ROLLBACK_FAILED', { requestId: request.id })
  }
  notify(
    [request.requester.id],
    `요청 실행이 끝났습니다: ${request.prompt.slice(0, 30)}`,
    `/requests/${request.id}`,
    'requestResults',
  )
  endLogs(request.id)
}
