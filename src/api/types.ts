/**
 * API 명세서의 데이터 모델(1.3 열거형, 2장)을 옮긴 타입.
 * 명세서에 모양이 없는 응답은 화면에 필요한 만큼만 정하고 TODO(spec)으로 표시했다.
 */

export type Role = 'ADMIN' | 'DEPT_MANAGER' | 'EMPLOYEE'
export type Network = 'INTERNAL' | 'EXTERNAL'

export type RequestStatus =
  | 'ANALYZING'
  | 'ANALYSIS_FAILED'
  | 'REVIEWING'
  | 'PENDING_APPROVAL'
  | 'REAPPROVAL_REQUIRED'
  | 'VERIFICATION_FAILED'
  | 'REJECTED'
  | 'CANCELED'
  | 'RUNNING'
  | 'KILLED'
  | 'COMPLETED'
  | 'PARTIALLY_COMPLETED'
  | 'FAILED'
  | 'ROLLING_BACK'
  | 'ROLLED_BACK'
  | 'ROLLBACK_FAILED'

export type TaskStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'BLOCKED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'SKIPPED'
  | 'ROLLED_BACK'

export type TaskType = 'DOC' | 'CODE_MINOR' | 'CODE_FEATURE' | 'DATA_READ' | 'DATA_WRITE' | 'DB' | 'DEPLOY'
export type Risk = 'LOW' | 'MEDIUM' | 'HIGH' | 'FORBIDDEN'
export type RequestSource = 'PROMPT' | 'EDITOR' | 'ROLLBACK'
export type PlanKind = 'NORMAL' | 'ROLLBACK'
export type ApproverRule = 'ANYONE' | 'SAME_DEPT_OTHER' | 'PROJECT_OWNER' | 'DEPT_MANAGER' | 'ADMIN'
export type PolicyPreset = 'SMALL' | 'MEDIUM' | 'LARGE'
export type SigningKeyStatus = 'PENDING' | 'REGISTERED' | 'REVOKED'

export type FailedCheck =
  | 'DECRYPT_FAILED'
  | 'PLAN_HASH_MISMATCH'
  | 'UNKNOWN_PLAN'
  | 'SIGNATURE_INVALID'
  | 'KEY_NOT_REGISTERED'
  | 'NONCE_ALREADY_USED'
  | 'MISSING_REQUIRED_APPROVER'
  | 'FORBIDDEN_TASK'

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'OTP_REQUIRED'
  | 'FORBIDDEN_ROLE'
  | 'INTERNAL_NETWORK_ONLY'
  | 'NOT_APPROVER'
  | 'KEY_NOT_REGISTERED'
  | 'NOT_FOUND'
  | 'INVALID_STATE'
  | 'PLAN_HASH_MISMATCH'
  | 'EDIT_CONFLICT'
  | 'OWNER_MINIMUM'
  | 'RETRY_LIMIT'
  | 'FORBIDDEN_TASK'
  | 'EXECUTOR_UNAVAILABLE'

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

// ── 사용자·조직 ────────────────────────────────────────────

export interface UserRef {
  id: string
  name: string
  departmentId: string | null
}

export interface User extends UserRef {
  employeeNo: string
  role: Role
  slackUserId: string | null
  active: boolean
  mustChangePassword: boolean
}

export interface Me extends User {
  network: Network
  signingKeyStatus: SigningKeyStatus | 'NONE'
  otpEnrolled: boolean
}

export interface Department {
  id: string
  name: string
}

export interface LoginResponse {
  otpRequired: boolean
  /** 외부망이면 OTP 확인에 쓰는 임시 토큰 */
  tempToken?: string
  accessToken?: string
  mustChangePassword?: boolean
}

export interface TokenResponse {
  accessToken: string
  mustChangePassword?: boolean
}

export interface SigningKey {
  keyId: string
  userId: string
  userName: string
  publicKey: string
  status: SigningKeyStatus
  createdAt: string
  registeredAt: string | null
}

// TODO(spec): 알림 설정의 항목은 명세에 없어 DEP-04와 권한 매트릭스 문구에서 뽑았다.
export interface NotificationSettings {
  slackUserId: string | null
  approvalRequests: boolean
  requestResults: boolean
}

export interface CreateUserResponse {
  user: User
  initialPassword: string
}

// ── 프로젝트·기획서 ────────────────────────────────────────

export interface Project {
  id: string
  name: string
  departmentId: string
  repository: string
  baseCommit: string
  owners: UserRef[]
}

export interface ProjectSpec {
  projectId: string
  version: number
  body: string
  updatedAt: string
  updatedBy: { id: string; name: string }
}

export type ChangeRequestStatus = 'OPEN' | 'ACCEPTED' | 'REJECTED'

export interface SpecChangeRequest {
  id: string
  projectId: string
  content: string
  reason: string
  requester: UserRef
  status: ChangeRequestStatus
  rejectReason: string | null
  createdAt: string
  decidedAt: string | null
}

// ── 정책·승인 기준표 ───────────────────────────────────────

export interface Policy {
  preset: PolicyPreset
  slackNotifications: 'OPTIONAL' | 'ON'
  auditRetention: string
  // TODO(spec): Slack 연동은 PUT만 있어, 현재 값을 정책 조회에 함께 담았다.
  slackIntegration: SlackIntegration | null
}

export interface SlackIntegration {
  workspace: string
  defaultChannel: string
}

export interface ApprovalMatrixRow {
  taskType: TaskType
  label: string
  examples: string
  defaultRisk: Exclude<Risk, 'FORBIDDEN'>
  approverRule: ApproverRule
}

// ── 금지 작업 ──────────────────────────────────────────────

export type ForbiddenRuleStatus = 'ACTIVE' | 'RELEASE_PENDING'
export type ForbiddenProposalStatus = 'OPEN' | 'CONFIRMED' | 'REJECTED'

export interface ForbiddenRule {
  id: string
  departmentId: string
  taskType: TaskType
  target: string
  reason: string
  status: ForbiddenRuleStatus
  createdAt: string
}

export interface ForbiddenProposal {
  id: string
  departmentId: string
  taskType: TaskType
  target: string
  reason: string
  status: ForbiddenProposalStatus
  proposer: UserRef
  rejectReason: string | null
  createdAt: string
}

// ── 요청·Plan·작업 (명세 2.1, 2.2) ──────────────────────────

export interface TaskContent {
  diff?: string
  command?: string
  query?: string
  body?: string
}

export interface ApproverRequirement {
  rule: ApproverRule
  count: number
  candidates?: string[]
}

/**
 * TODO(spec): 명세는 "여러 규칙이 함께 붙을 수 있음"이라고만 한다.
 * 예시 모양을 지키려고 첫 규칙은 그대로 두고 나머지를 additional에 담았다.
 */
export interface RequiredApprovers extends ApproverRequirement {
  additional?: ApproverRequirement[]
}

export interface Task {
  id: string
  order: number
  type: TaskType
  risk: Risk
  title: string
  description?: string
  target: string
  content: TaskContent
  relatedDepartments: string[]
  requiredApprovers: RequiredApprovers
  status: TaskStatus
  /** AI가 기본 위험도보다 올렸을 때만 있음 */
  riskRaised?: { from: Risk; reason: string }
  forbiddenReason?: string
}

export interface Plan {
  id: string
  requestId: string
  projectId: string
  kind: PlanKind
  repository: string
  baseCommit: string
  planHash: string | null
  executorSignature: string | null
  tasks: Task[]
}

export interface PlanHashTarget {
  requestId: string
  planId: string
  projectId: string
  repository: string
  baseCommit: string
  tasks: Array<{
    order: number
    id: string
    type: TaskType
    risk: Risk
    target: string
    content: TaskContent
  }>
}

export interface RequestSummary {
  id: string
  projectId: string
  requester: UserRef
  prompt: string
  source: RequestSource
  status: RequestStatus
  analysisAttempts: number
  currentPlanId: string | null
  createdAt: string
  updatedAt: string
}

export interface ApprovalRecord {
  userId: string
  name: string
  network: Network
  at: string
  self: boolean
}

export interface RequirementStatus {
  rule: ApproverRule
  count: number
  candidates: Array<{ id: string; name: string }>
  approvedBy: ApprovalRecord[]
  satisfied: boolean
}

export interface TaskApprovalStatus {
  taskId: string
  requirements: RequirementStatus[]
}

export interface RequestEvent {
  status: RequestStatus
  at: string
  by: string | null
}

/** TODO(spec): 요청 상세의 추가 필드 이름은 명세에 없어 화면 요구에서 정했다. */
export interface RequestDetail extends RequestSummary {
  projectName: string
  plan: Plan | null
  approvalStatus: TaskApprovalStatus[]
  clarification: { question: string } | null
  analysisError: string | null
  changedTaskIds: string[]
  removedTaskTitles: string[]
  failedChecks: FailedCheck[]
  rejection: { by: string; reason: string; at: string; taskIds: string[] } | null
  kill: { by: string; reason: string; at: string; skippedTaskIds: string[] } | null
  events: RequestEvent[]
}

export interface CreateRequestBody {
  projectId: string
  prompt: string
}

export interface PlanChange {
  op: 'UPDATE' | 'DELETE'
  taskId: string
  instruction?: string
}

export interface PatchPlanBody {
  basePlanId?: string
  changes?: PlanChange[]
  /** AI 확인 질문(clarification)의 답 */
  answer?: string
}

export interface AcceptedRequest {
  id: string
  status: RequestStatus
}

export interface SubmitResponse {
  id: string
  status: RequestStatus
  planId: string
  planHash: string
  executorSignature: string
  selfApprovableTaskIds: string[]
}

// ── 승인 (명세 2.4, 4.4, 4.5) ───────────────────────────────

export interface ApprovalContext {
  requestId: string
  // TODO(spec): 명세 예시에는 없지만 클라이언트가 해시를 다시 계산하려면 projectId가 필요해 Plan에 담았다.
  plan: Plan
  planHash: string
  executorSignature: string
  approvableTaskIds: string[]
  blockedTaskIds: string[]
  blockedReason: 'INTERNAL_NETWORK_ONLY' | null
  network: Network
}

export interface ApprovalPayload {
  planHash: string
  requestId: string
  planId: string
  taskIds: string[]
  approverId: string
  keyId: string
  issuedAt: string
  nonce: string
  network: Network
}

export interface SignedApproval {
  payload: ApprovalPayload
  signature: string
}

export interface ApprovalEnvelope {
  alg: 'HPKE-X25519-AES256GCM'
  encapsulatedKey: string
  ciphertext: string
}

export interface SubmitApprovalBody {
  planId: string
  planHash: string
  taskIds: string[]
  keyId: string
  envelope: ApprovalEnvelope
}

export interface SubmitApprovalResponse {
  requestId: string
  status: RequestStatus
  approvedTaskIds: string[]
  remainingTaskIds: string[]
  executionRequested: boolean
}

export interface RejectBody {
  taskIds: string[]
  reason: string
}

// TODO(spec): 목록 항목 모양은 "위험도·요청자·요청 시각"만 명세되어 있다.
export interface PendingApproval {
  requestId: string
  taskId: string
  taskTitle: string
  type: TaskType
  risk: Risk
  requester: UserRef
  projectId: string
  projectName: string
  requestedAt: string
  blockedReason: 'INTERNAL_NETWORK_ONLY' | null
}

export interface KillResponse {
  id: string
  status: RequestStatus
  skippedTaskIds: string[]
}

export type LogLevel = 'INFO' | 'CMD' | 'ERROR' | 'SUCCESS'

export interface LogLine {
  seq: number
  at: string
  level: LogLevel
  taskId: string | null
  text: string
}

// ── 문서 ───────────────────────────────────────────────────

export interface DocumentSummary {
  id: string
  projectId: string
  title: string
  path: string
  currentVersion: number
  updatedAt: string
}

export interface DocumentVersion {
  documentId: string
  version: number
  body: string
  createdAt: string
  createdBy: { id: string; name: string }
  /** 이 버전을 적용한 요청. 시드 초기 버전이면 null */
  requestId: string | null
}

export type DocumentVersionSummary = Omit<DocumentVersion, 'body'>

export interface TaskDocument {
  documentId: string | null
  title: string
  currentVersion: number | null
  currentBody: string
  proposedBody: string
  diff: string
}

// TODO(spec): 롤백 요청 본문은 명세에 없다. 되돌릴 문서와 버전을 지정하게 했다.
export interface RollbackBody {
  documentId: string
  version: number
}

// ── 에디터 ─────────────────────────────────────────────────

export interface FileEntry {
  name: string
  path: string
  type: 'file' | 'dir'
}

export interface FileListing {
  path: string
  ref: string
  baseCommit: string
  entries: FileEntry[]
}

export interface FileContent {
  path: string
  ref: string
  content: string
}

export interface EditorChangeBody {
  baseCommit: string
  description: string
  files: Array<{ path: string; patch: string }>
}

export interface EditorChangeResponse {
  requestId: string
  source: 'EDITOR'
  status: RequestStatus
}

// ── 대시보드·감사 로그 ─────────────────────────────────────

export type DashboardScope = 'COMPANY' | 'DEPARTMENT' | 'ME'

export interface DepartmentStat {
  departmentId: string
  name: string
  requests: number
  pendingApprovals: number
  running: number
}

// TODO(spec): 응답 필드 이름은 명세의 "요청 수, 승인 대기, 위험도 분포, 상태별 건수"에서 정했다.
export interface Dashboard {
  scope: DashboardScope
  requestCount: number
  pendingApprovalCount: number
  riskDistribution: Record<Risk, number>
  statusCounts: Partial<Record<RequestStatus, number>>
  byDepartment?: DepartmentStat[]
}

export type AuditAction =
  | 'REQUEST_CREATED'
  | 'PLAN_UPDATED'
  | 'SUBMITTED'
  | 'APPROVAL_SUBMITTED'
  | 'REJECTED'
  | 'REQUEST_CANCELED'
  | 'EXECUTION_STARTED'
  | 'VERIFICATION_FAILED'
  | 'TASK_SUCCEEDED'
  | 'TASK_FAILED'
  | 'KILLED'
  | 'ROLLBACK_REQUESTED'
  | 'ROLLBACK_SUCCEEDED'
  | 'ROLLBACK_FAILED'
  | 'SPEC_UPDATED'
  | 'FORBIDDEN_RULE_PROPOSED'
  | 'FORBIDDEN_RULE_CONFIRMED'
  | 'FORBIDDEN_RULE_REJECTED'
  | 'FORBIDDEN_RULE_RELEASE_REQUESTED'
  | 'KEY_SUBMITTED'
  | 'KEY_REGISTERED'
  | 'KEY_REVOKED'
  | 'LOGIN'
  | 'ACCOUNT_CHANGED'
  | 'POLICY_CHANGED'

export interface AuditLog {
  id: string
  at: string
  actor: { id: string; name: string }
  action: AuditAction
  target: { requestId?: string; taskIds?: string[]; projectId?: string; label?: string }
  network: Network
  ip: string
  detail: Record<string, unknown>
}

export interface AuditLogQuery {
  actorId?: string
  departmentId?: string
  projectId?: string
  requestId?: string
  action?: string
  network?: Network
  from?: string
  to?: string
  cursor?: string
  limit?: number
}
