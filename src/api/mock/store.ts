import type {
  AdminSigningKey,
  ApprovalMatrixRule,
  ApprovalRecord,
  AuditAction,
  AuditExportFilters,
  AuditLog,
  Department,
  DocumentSummary,
  DocumentVersion,
  DocumentVersionSummary,
  ErrorCode,
  ExportFormat,
  ExportStatus,
  FailedCheck,
  ForbiddenProposal,
  ForbiddenRule,
  LogLine,
  Network,
  NotificationSettings,
  Plan,
  PlanChange,
  PlanHashTarget,
  Policy,
  PolicyPreset,
  Project,
  ProjectSpec,
  RequestDetail,
  RequestEvent,
  RequestStatus,
  RequestSummary,
  SpecChangeRequest,
  TaskContent,
  TaskType,
  User,
  WebshellEvent,
  WebshellExecution,
} from '../types'

// ── 서버 내부 모델 ─────────────────────────────────────────

export interface StoredUser extends User {
  password: string
  passwordChangeRequired: boolean
  otpEnrolled: boolean
  /** 발급만 하고 아직 확인하지 않은 값도 들어 있다 */
  otpSecret: string | null
}

export interface StoredApproval {
  /** 승인 기록 ID. 한 번에 여러 작업을 서명하면 작업마다 같은 값이다 (서버 ApprovalResponse.id) */
  id: string
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

export type TamperAttack = 'SWAP_BEFORE_SIGN' | 'SWAP_DISPLAY' | 'SWAP_AFTER_SIGN' | 'FORGE_APPROVAL'

export interface StoredRequest extends RequestSummary, Pick<RequestDetail, 'clarification'> {
  plan: Plan | null
  // TODO(spec): 아래 다섯 개는 서버에 없는 목 전용 기록이다. 시연 화면에서만 쓴다.
  changedTaskIds: string[]
  removedTaskTitles: string[]
  failedChecks: FailedCheck[]
  rejection: NonNullable<RequestDetail['rejection']> | null
  kill: NonNullable<RequestDetail['kill']> | null
  events: RequestEvent[]
  /** 화면 표시용 "누가 어떤 작업을 승인했는지" (기능 명세서 5.9 ⑥) */
  approvals: StoredApproval[]
  /** 승인 기록 (명세 2.5). 웹쉘에는 이 안의 keyId와 envelope만 보낸다 */
  approvalRecords: ApprovalRecord[]
  pendingAnalysis: PendingAnalysis | null
  submittedAt: string | null
  /** 시드용: 타이머를 돌리지 않고 그 상태로 멈춰 둔다 */
  frozen?: boolean
  /** 실행 시뮬레이션의 로그 간격과 진행 위치 */
  execStepMs?: number
  execLine?: number
  rollback?: { documentId: string; version: number }
  /** 시드 전용: 화면의 Plan과 다른 해시 대상을 승인 자료로 내려 준다 */
  forgedHashTarget?: PlanHashTarget
  /** 변조 시연 전용: 이 요청에 어떤 공격을 했는지 */
  tamperAttack?: TamperAttack
  /** 변조 시연 전용: 서명이 제출된 뒤 웹쉘 검증 직전에 웹 서비스가 바꿔치기할 내용 */
  armedPlanSwap?: { taskId: string; target: string; content: TaskContent }
  /** 웹쉘이 서명해 돌려준 실행 상태 */
  execution?: WebshellExecution
  webshellEvents: WebshellEvent[]
  /** 진행 상황 트리의 대체된 Plan 가지 (기능 명세서 5.12). 이전 저장본에는 없을 수 있다 */
  planHistory?: Array<{ version: number; plan: Plan; supersededAt: string }>
}

/** 파일 내용은 저장하지 않는다. 내려받을 때 filters와 createdAt으로 다시 만든다 */
export interface StoredAuditExport {
  id: string
  requesterId: string
  format: ExportFormat
  filters: AuditExportFilters
  status: ExportStatus
  rowCount: number
  fileName: string
  createdAt: string
  expiresAt: string | null
}

export interface SlackMessage {
  id: string
  toUserId: string
  toName: string
  text: string
  link: string
  at: string
}

/** 응답에는 나가지 않는다. 서버의 프로젝트에는 기준 커밋이 없고, 파일 목록이 알려 준다. */
export interface StoredProject extends Project {
  baseCommit: string
}

export interface MockDb {
  schema: number
  network: Network
  session: { userId: string; lastActiveAt: number } | null
  seq: number
  users: StoredUser[]
  departments: Department[]
  projects: StoredProject[]
  specs: Record<string, ProjectSpec[]>
  changeRequests: SpecChangeRequest[]
  policy: Pick<Policy, 'preset' | 'version' | 'slackIntegration'>
  matrix: ApprovalMatrixRule[]
  signingKeys: AdminSigningKey[]
  forbiddenRules: ForbiddenRule[]
  proposals: ForbiddenProposal[]
  requests: StoredRequest[]
  logs: Record<string, LogLine[]>
  documents: DocumentSummary[]
  docVersions: Array<DocumentVersion & Pick<DocumentVersionSummary, 'requestId' | 'createdBy'>>
  files: Record<string, Record<string, string>>
  auditLogs: AuditLog[]
  auditExports: StoredAuditExport[]
  slackOutbox: SlackMessage[]
  notificationSettings: Record<string, NotificationSettings>
  /** 웹쉘 쪽 저장소. 서비스 DB와 별개라는 점을 코드에서도 나눠 둔다 */
  webshell: {
    usedNonces: string[]
    /** 요청별 전용 세션: 검증을 통과해 이 세션에서 실행할 작업 (API 명세 5.1) */
    sessions: Record<string, string[]>
    /**
     * 웹쉘 정책 (기능 명세서 5.7, 5.9): 승인자 공개키 목록, 금지 규칙, 승인 기준표·규모 프리셋 사본.
     * MOCK: 관리자 서명 확인은 흉내 내지 않고 배포하는 쪽에서 바로 고친다.
     */
    policy: {
      keys: Array<{ keyId: string; userId: string; publicKey: string }>
      forbiddenRules: Array<{ departmentId: string; taskType: TaskType; target: string }>
      preset: PolicyPreset
      matrix: ApprovalMatrixRule[]
    }
  }
}

// ── 싱글턴 상태 ────────────────────────────────────────────

const STORAGE_KEY = 'beforeai.mock.db.v1'
export const SCHEMA_VERSION = 15

export const mockConfig = {
  latencyMs: 180,
  analysisMs: 1800,
  execStepMs: 650,
  /** 웹쉘에 연결할 수 없을 때 실행 요청을 다시 시도하는 간격 */
  webshellRetryMs: 5000,
  /** false면 웹쉘 연결이 끊긴 것처럼 동작한다. 새로고침하면 true로 돌아온다 */
  webshellReachable: true,
  /** 감사 로그 내보내기 한 번의 최대 건수 (기능 명세서 5.11) */
  auditExportLimit: 100000,
  /** 내보내기 파일이 준비될 때까지 걸리는 시간 */
  auditExportMs: 3000,
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

export function requireProject(id: string): StoredProject {
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

const PLAN_HISTORY_LIMIT = 5

/** Plan을 새것으로 바꾸기 직전에 부른다. 바뀐 이력은 진행 상황 트리에 접힌 가지로 남는다. */
export function archivePlan(request: StoredRequest) {
  if (!request.plan) return
  const history = (request.planHistory ??= [])
  history.push({ version: (history.at(-1)?.version ?? 0) + 1, plan: request.plan, supersededAt: nowIso() })
  history.splice(0, Math.max(0, history.length - PLAN_HISTORY_LIMIT))
}

export const SYSTEM_ACTOR = { id: 'system', name: '웹쉘' }

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

export function appendLog(requestId: string, line: LogLine) {
  ;(db().logs[requestId] ??= []).push(line)
  logListeners.get(requestId)?.forEach((listener) => listener.onLine(line))
}

export function endLogs(requestId: string) {
  logListeners.get(requestId)?.forEach((listener) => listener.onEnd())
  logListeners.delete(requestId)
}
