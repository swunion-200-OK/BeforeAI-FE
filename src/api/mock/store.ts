import type {
  ApprovalEnvelope,
  ApprovalMatrixRow,
  AuditAction,
  AuditLog,
  Department,
  DocumentSummary,
  DocumentVersion,
  ErrorCode,
  ForbiddenProposal,
  ForbiddenRule,
  LogLevel,
  LogLine,
  Network,
  NotificationSettings,
  Plan,
  PlanChange,
  Policy,
  Project,
  ProjectSpec,
  RequestDetail,
  RequestStatus,
  RequestSummary,
  SigningKey,
  SpecChangeRequest,
  TaskType,
  User,
} from '../types'

// ── 서버 내부 모델 ─────────────────────────────────────────

export interface StoredUser extends User {
  password: string
  otpEnrolled: boolean
}

export interface StoredApproval {
  planId: string
  taskId: string
  rule: string
  userId: string
  name: string
  network: Network
  at: string
  self: boolean
}

export type PendingAnalysis =
  | { kind: 'NEW' }
  | { kind: 'ANSWER'; answer: string }
  | { kind: 'PATCH'; changes: PlanChange[]; returnStatus: 'REVIEWING' | 'REAPPROVAL_REQUIRED' }
  | { kind: 'EDITOR'; description: string; files: Array<{ path: string; patch: string }> }

export interface StoredRequest
  extends RequestSummary,
    Pick<
      RequestDetail,
      | 'clarification'
      | 'analysisError'
      | 'changedTaskIds'
      | 'removedTaskTitles'
      | 'failedChecks'
      | 'rejection'
      | 'kill'
      | 'events'
    > {
  plan: Plan | null
  approvals: StoredApproval[]
  envelopes: Array<{ planId: string; keyId: string; envelope: ApprovalEnvelope }>
  pendingAnalysis: PendingAnalysis | null
  submittedAt: string | null
  /** 시드용: 타이머를 돌리지 않고 그 상태로 멈춰 둔다 */
  frozen?: boolean
  /** 실행 시뮬레이션의 로그 간격과 진행 위치 */
  execStepMs?: number
  execLine?: number
  rollback?: { documentId: string; version: number }
}

export interface SlackMessage {
  id: string
  toUserId: string
  toName: string
  text: string
  link: string
  at: string
}

export interface MockDb {
  schema: number
  network: Network
  session: { userId: string; lastActiveAt: number } | null
  seq: number
  users: StoredUser[]
  departments: Department[]
  projects: Project[]
  specs: Record<string, ProjectSpec[]>
  changeRequests: SpecChangeRequest[]
  policy: Policy
  matrix: ApprovalMatrixRow[]
  signingKeys: SigningKey[]
  forbiddenRules: ForbiddenRule[]
  proposals: ForbiddenProposal[]
  requests: StoredRequest[]
  logs: Record<string, LogLine[]>
  documents: DocumentSummary[]
  docVersions: DocumentVersion[]
  files: Record<string, Record<string, string>>
  auditLogs: AuditLog[]
  slackOutbox: SlackMessage[]
  notificationSettings: Record<string, NotificationSettings>
  /** 실행기 쪽 저장소. 서비스 DB와 별개라는 점을 코드에서도 나눠 둔다 */
  executor: {
    plans: Record<string, true>
    usedNonces: string[]
    keys: Array<{ keyId: string; userId: string; publicKey: string }>
    localRules: Array<{ departmentId: string; taskType: TaskType; target: string }>
  }
}

// ── 싱글턴 상태 ────────────────────────────────────────────

const STORAGE_KEY = 'beforeai.mock.db.v1'
export const SCHEMA_VERSION = 2

export const mockConfig = {
  latencyMs: 180,
  analysisMs: 1800,
  execStepMs: 650,
}

type LogListener = { onLine: (line: LogLine) => void; onEnd: () => void }
const logListeners = new Map<string, Set<LogListener>>()

let current: MockDb | null = null
/** 초기화할 때마다 올린다. 이전 세대의 타이머는 이 값을 보고 멈춘다. */
export let generation = 0

export function db(): MockDb {
  if (!current) throw new Error('목 DB가 아직 준비되지 않았습니다')
  return current
}

export function setDb(next: MockDb) {
  current = next
  generation++
  // 초기화하면 이전 로그 구독은 의미가 없다. 끊어야 뷰어가 다시 연결한다.
  for (const set of logListeners.values()) set.forEach((listener) => listener.onEnd())
  logListeners.clear()
}

export function loadPersisted(): MockDb | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as MockDb
    return parsed.schema === SCHEMA_VERSION ? parsed : null
  } catch {
    return null
  }
}

export function persist() {
  if (!current) return
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(current))
  } catch {
    // 저장 공간이 부족해도 메모리 상태로 시연은 계속된다.
  }
  changeListeners.forEach((listener) => listener())
}

const changeListeners = new Set<() => void>()
export function onDbChange(listener: () => void) {
  changeListeners.add(listener)
  return () => {
    changeListeners.delete(listener)
  }
}

// ── 공통 유틸 ──────────────────────────────────────────────

export class HttpError extends Error {
  readonly status: number
  readonly code: ErrorCode | 'VERIFICATION_FAILED'
  readonly details: Record<string, unknown>

  constructor(status: number, code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export function nextId(prefix: string): string {
  const database = db()
  database.seq += 1
  return `${prefix}-${database.seq}`
}

export const nowIso = () => new Date().toISOString()

export function requireRequest(id: string): StoredRequest {
  const found = db().requests.find((r) => r.id === id)
  if (!found) throw new HttpError(404, 'NOT_FOUND', '요청을 찾을 수 없습니다')
  return found
}

export function requireProject(id: string): Project {
  const found = db().projects.find((p) => p.id === id)
  if (!found) throw new HttpError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다')
  return found
}

export function requireUser(id: string): StoredUser {
  const found = db().users.find((u) => u.id === id)
  if (!found) throw new HttpError(404, 'NOT_FOUND', '사용자를 찾을 수 없습니다')
  return found
}

export function setStatus(request: StoredRequest, status: RequestStatus, by: string | null) {
  request.status = status
  request.updatedAt = nowIso()
  request.events.push({ status, at: request.updatedAt, by })
}

export const SYSTEM_ACTOR = { id: 'system', name: '실행기' }

export function ipFor(network: Network) {
  return network === 'INTERNAL' ? '100.64.12.34' : '203.0.113.10'
}

export function audit(
  actor: { id: string; name: string },
  action: AuditAction,
  target: AuditLog['target'],
  detail: Record<string, unknown> = {},
) {
  const database = db()
  database.auditLogs.unshift({
    id: nextId('log'),
    at: nowIso(),
    actor: { id: actor.id, name: actor.name },
    action,
    target,
    network: database.network,
    ip: ipFor(database.network),
    detail,
  })
}

/** Slack 알림은 보내지 않고 쌓아 두기만 한다. 링크만 담고 서명은 담지 않는다. */
export function notify(
  userIds: string[],
  text: string,
  link: string,
  kind: 'approvalRequests' | 'requestResults' | 'always' = 'always',
) {
  const database = db()
  for (const userId of new Set(userIds)) {
    const user = database.users.find((u) => u.id === userId)
    if (!user) continue
    const settings = database.notificationSettings[userId]
    if (kind !== 'always' && settings && !settings[kind]) continue
    database.slackOutbox.unshift({
      id: nextId('slack'),
      toUserId: user.id,
      toName: user.name,
      text,
      link,
      at: nowIso(),
    })
  }
  database.slackOutbox.length = Math.min(database.slackOutbox.length, 30)
}

// ── 실행 로그 스트림 ───────────────────────────────────────

export function subscribeLogs(requestId: string, listener: LogListener) {
  const set = logListeners.get(requestId) ?? new Set<LogListener>()
  set.add(listener)
  logListeners.set(requestId, set)
  return () => {
    set.delete(listener)
  }
}

export function appendLog(requestId: string, level: LogLevel, taskId: string | null, text: string) {
  const database = db()
  const lines = (database.logs[requestId] ??= [])
  const line: LogLine = { seq: lines.length + 1, at: nowIso(), level, taskId, text }
  lines.push(line)
  logListeners.get(requestId)?.forEach((listener) => listener.onLine(line))
}

export function endLogs(requestId: string) {
  logListeners.get(requestId)?.forEach((listener) => listener.onEnd())
  logListeners.delete(requestId)
}
