/**
 * 실행기 흉내. 명세상 실행기는 웹 서비스를 믿지 않으므로,
 * 여기서도 서비스가 평문으로 기록한 승인 내역은 보지 않고 서명만으로 판단한다.
 */
import { ed25519 } from '@noble/curves/ed25519.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { base64ToUtf8, bytesToBase64 } from '../../crypto/encoding'
import { hashService } from '../../crypto/hashService'
import { signingService } from '../../crypto/signingService'
import type { FailedCheck, LogLevel, Plan, RequestStatus, SignedApproval, Task } from '../types'
import { requirementsOf, qualifies } from './policy'
import {
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
} from './store'

const encoder = new TextEncoder()
const derive = (seed: string) => sha256(encoder.encode(seed))

const EXECUTOR_SECRET = derive('beforeai-mock-executor-key')
const IMPOSTOR_SECRET = derive('beforeai-mock-impostor-key')

export const EXECUTOR_PUBLIC_KEY = bytesToBase64(ed25519.getPublicKey(EXECUTOR_SECRET))

export function signPlanHash(planHash: string): string {
  return bytesToBase64(ed25519.sign(encoder.encode(planHash), EXECUTOR_SECRET))
}

/** 시드 전용: 고정된 공개키로 확인되지 않는 서명 */
export function impostorSignature(planHash: string): string {
  return bytesToBase64(ed25519.sign(encoder.encode(planHash), IMPOSTOR_SECRET))
}

export function registerPlan(plan: Plan) {
  const planHash = hashService.computePlanHash(plan)
  plan.planHash = planHash
  plan.executorSignature = signPlanHash(planHash)
  db().executor.plans[planHash] = true
}

// ── 실행 직전 검증 (기능 명세서 5.9 ③) ─────────────────────

function runnableTasks(plan: Plan): Task[] {
  return plan.tasks.filter((t) => t.status === 'APPROVED' || t.status === 'PENDING')
}

export function verifyExecution(request: StoredRequest): { failed: FailedCheck[]; forbiddenTaskIds: string[] } {
  const database = db()
  const plan = request.plan as Plan
  const failed = new Set<FailedCheck>()
  const forbiddenTaskIds: string[] = []

  const recomputed = hashService.computePlanHash(plan)
  if (!database.executor.plans[recomputed]) failed.add('UNKNOWN_PLAN')
  if (plan.planHash !== recomputed) failed.add('PLAN_HASH_MISMATCH')

  const nonces: string[] = []
  const signedBy: Array<{ userId: string; taskIds: string[] }> = []

  for (const { keyId, envelope, planId } of request.envelopes) {
    if (planId !== plan.id) continue
    let signed: SignedApproval
    try {
      signed = JSON.parse(base64ToUtf8(envelope.ciphertext)) as SignedApproval
    } catch {
      failed.add('DECRYPT_FAILED')
      continue
    }
    if (signed.payload.planHash !== recomputed) failed.add('PLAN_HASH_MISMATCH')
    const key = database.executor.keys.find((k) => k.keyId === keyId)
    if (!key) {
      failed.add('KEY_NOT_REGISTERED')
      continue
    }
    if (!signingService.verifyApproval(signed, key.publicKey) || key.userId !== signed.payload.approverId) {
      failed.add('SIGNATURE_INVALID')
      continue
    }
    if (database.executor.usedNonces.includes(signed.payload.nonce) || nonces.includes(signed.payload.nonce)) {
      failed.add('NONCE_ALREADY_USED')
      continue
    }
    nonces.push(signed.payload.nonce)
    signedBy.push({ userId: signed.payload.approverId, taskIds: signed.payload.taskIds })
  }

  const project = requireProject(request.projectId)
  for (const task of runnableTasks(plan)) {
    for (const requirement of requirementsOf(task)) {
      const signers = signedBy.filter((s) => {
        const user = database.users.find((u) => u.id === s.userId)
        return s.taskIds.includes(task.id) && user && qualifies(user, requirement, request)
      })
      if (signers.length < requirement.count) failed.add('MISSING_REQUIRED_APPROVER')
    }
    const hitsLocalRule = database.executor.localRules.some(
      (rule) =>
        [project.departmentId, ...task.relatedDepartments].includes(rule.departmentId) &&
        rule.taskType === task.type &&
        (rule.target === '*' || task.target.toLowerCase().includes(rule.target.toLowerCase())),
    )
    if (hitsLocalRule) {
      failed.add('FORBIDDEN_TASK')
      forbiddenTaskIds.push(task.id)
    }
  }

  if (failed.size === 0) database.executor.usedNonces.push(...nonces)
  return { failed: [...failed], forbiddenTaskIds }
}

/** 필요한 승인이 다 모이면 호출된다. 통과하면 RUNNING, 실패하면 VERIFICATION_FAILED */
export function requestExecution(request: StoredRequest) {
  const { failed, forbiddenTaskIds } = verifyExecution(request)
  const plan = request.plan as Plan
  if (failed.length > 0) {
    request.failedChecks = failed
    for (const task of plan.tasks) {
      if (forbiddenTaskIds.includes(task.id)) task.status = 'FAILED'
    }
    setStatus(request, 'VERIFICATION_FAILED', SYSTEM_ACTOR.name)
    audit(SYSTEM_ACTOR, 'VERIFICATION_FAILED', { requestId: request.id }, { failedChecks: failed })
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
    return
  }
  const rollingBack = plan.kind === 'ROLLBACK'
  setStatus(request, rollingBack ? 'ROLLING_BACK' : 'RUNNING', SYSTEM_ACTOR.name)
  audit(SYSTEM_ACTOR, 'EXECUTION_STARTED', { requestId: request.id, taskIds: plan.tasks.map((t) => t.id) })
  appendLog(request.id, 'INFO', null, '[실행기] 승인 서명 검증 통과. 1회용 ID 소진, 웹쉘 세션을 엽니다')
  request.execLine = 0
  scheduleExecution(request.id)
}

// ── 실행 시뮬레이션 ────────────────────────────────────────

type Line = { level: LogLevel; text: string }

function scriptFor(task: Task, requestId: string): Line[] {
  const cmd = (text: string): Line => ({ level: 'CMD', text: `$ ${text}` })
  const info = (text: string): Line => ({ level: 'INFO', text })
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
      return [info(`문서 작성 완료: ${task.target}`), info('문서 새 버전 저장')]
  }
}

function buildScript(request: StoredRequest): Array<Line & { taskId: string | null; endOf?: Task }> {
  const plan = request.plan as Plan
  const script: Array<Line & { taskId: string | null; endOf?: Task }> = []
  for (const task of plan.tasks.filter((t) => ['APPROVED', 'RUNNING', 'PENDING'].includes(t.status))) {
    script.push({ level: 'INFO', text: `[${task.id}] ${task.title} 시작`, taskId: task.id })
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
    if (task.status !== 'RUNNING') task.status = 'RUNNING'
    appendLog(request.id, current.level, current.taskId, current.text)
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
    appendLog(request.id, 'ERROR', task.id, `[${task.id}] 실패: 종료 코드 1`)
    audit(SYSTEM_ACTOR, 'TASK_FAILED', { requestId: request.id, taskIds: [task.id] })
    finish(request)
    return
  }
  task.status = plan.kind === 'ROLLBACK' ? 'ROLLED_BACK' : 'SUCCEEDED'
  appendLog(request.id, 'SUCCESS', task.id, `[${task.id}] 성공`)
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

  appendLog(request.id, 'INFO', null, '[실행기] 웹쉘 세션을 닫습니다')
  setStatus(request, final, SYSTEM_ACTOR.name)
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
