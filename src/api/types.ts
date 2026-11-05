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
  | 'WEBSHELL_UNAVAILABLE'
  | 'EXPORT_TOO_LARGE'

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

/** 어디가 무엇으로 바뀌는지 한 줄 */
export interface TaskChangeItem {
  where: string
  what: string
  before?: string
  after?: string
}

/**
 * TODO(spec): 명세에 없는 필드. 승인권자가 코드를 읽지 않아도 이해하도록 AI가 풀어 쓴 설명이다.
 * Plan 해시 대상(명세 2.3)이 아니므로 참고용이고, 서명 기준은 항상 content다.
 */
export interface TaskExplanation {
  summary: string
  changes: TaskChangeItem[]
  impact: string[]
  undo: string
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
  requiredApprovers: ApproverRequirement[]
  status: TaskStatus
  /** AI가 기본 위험도보다 올렸을 때만 있음 */
  riskRaised?: { from: Risk; reason: string }
  forbiddenReason?: string
  explanation?: TaskExplanation
}

export interface Plan {
  id: string
  requestId: string
  /** TODO(spec): 명세 2.2의 Plan에는 없고 2.3 해시 대상에만 있다. 목이 해시를 만들 때만 쓰고 화면은 읽지 않는다 */
  projectId: string
  kind: PlanKind
  repository: string
  baseCommit: string
  /** 웹 서비스가 만든 표시용 값. 승인자 기기와 웹쉘은 믿지 않고 각자 다시 계산한다 (명세 2.2, 2.3) */
  planHash: string | null
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

/** TODO(spec): 목록에서 한눈에 보려고 넣은 요약. 명세의 Request에는 없어 선택 필드로 둔다. */
export interface RequestTaskSummary {
  total: number
  risks: Record<Risk, number>
  /** 승인이 필요한 작업 수 (금지 제외) */
  required: number
  approved: number
  succeeded: number
  failed: number
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
  taskSummary?: RequestTaskSummary
}

/** 결재란에 찍는 한 사람의 승인. 2.5 승인 기록의 평문 항목으로 만든 화면용 값이다. */
export interface ApproverStamp {
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
  approvedBy: ApproverStamp[]
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
  /** TODO(spec): 명세에 없는 필드. 현재 Plan의 평문 승인 기록(2.5) 개수다. 0이거나 없으면 화면이 서명 검사를 통과라고 말하지 않는다 */
  approvalRecordCount?: number
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
  selfApprovableTaskIds: string[]
}

// ── 승인 (명세 2.4, 2.5, 4.4, 4.5) ──────────────────────────

export interface ApprovalContext {
  requestId: string
  /** 화면에 보여 줄 Plan. hashTarget과 내용이 같을 때만 서명한다 */
  plan: Pick<Plan, 'id' | 'tasks'>
  planHash: string
  /** 해시를 직접 다시 계산할 대상 (명세 2.3) */
  hashTarget: PlanHashTarget
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

/**
 * 웹 서비스가 보관하는 승인 기록 (명세 2.5).
 * 평문 항목은 화면 표시·사전 검사용이고 실행 판단에는 쓰지 않는다.
 * nonce·issuedAt·signature는 envelope 안에만 있다.
 */
export interface ApprovalRecord {
  id: string
  requestId: string
  planId: string
  planHash: string
  taskIds: string[]
  /** 요청 본문이 아니라 로그인한 사용자로 채운다 */
  approverId: string
  keyId: string
  /** 서버가 출발지 IP로 판별한 값 */
  network: Network
  envelope: ApprovalEnvelope
  createdAt: string
}

export interface SubmitApprovalResponse {
  requestId: string
  status: RequestStatus
  approvedTaskIds: string[]
  remainingTaskIds: string[]
  /** false면 승인이 덜 모였거나 웹쉘에 연결할 수 없는 것. 뒤의 경우 상태는 PENDING_APPROVAL로 남고 웹 서비스가 다시 시도한다 */
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
  /** 웹쉘 서명: base64(Ed25519(JCS({ requestId, seq, at, level, taskId, text }))) (명세 3.5) */
  webshellSignature: string
}

// ── 웹쉘 (명세 5장) ────────────────────────────────────────

/** TODO(spec): 명세는 "X25519·Ed25519 공개키와 지문"이라고만 한다. 필드 이름과 지문 형식은 여기서 정했다. */
export interface WebshellPublicKey {
  /** 승인 서명 암호화용 X25519 */
  encryptionKey: string
  /** 실행 결과·로그 확인용 Ed25519 */
  signingKey: string
  fingerprint: string
}

/** POST /v1/executions 본문 (명세 5.1). 웹 서비스 서버만 호출한다 */
export interface ExecutionRequestBody {
  plan: PlanHashTarget
  approvals: Array<Pick<ApprovalRecord, 'keyId' | 'envelope'>>
}

/** POST /v1/executions 응답과 GET /v1/executions/{id}. TODO(spec): 작업별 결과의 모양은 명세에 없다. */
export interface WebshellExecution {
  executionId: string
  planHash: string
  status: RequestStatus
  taskResults: Array<{ taskId: string; status: TaskStatus }>
  webshellSignature: string
}

/** 웹쉘 → 웹 서비스 콜백 이벤트. 로그 조각은 LogLine으로 따로 온다. TODO(spec): 이벤트 모양은 명세에 없다. */
export interface WebshellEvent {
  requestId: string
  executionId: string | null
  type: 'TASK_STARTED' | 'TASK_SUCCEEDED' | 'TASK_FAILED' | 'FINAL_STATUS' | 'VERIFICATION_FAILED' | 'STEP'
  at: string
  taskId?: string
  status?: RequestStatus
  failedChecks?: FailedCheck[]
  step?: WebshellStep
  webshellSignature: string
}

export type StepStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED'

/** 실행 로그 seq 구간. 아직 진행 중이면 to가 null이다 (명세 2.6) */
export interface LogRange {
  from: number
  to: number | null
}

/** TODO(spec): 실행 단계 콜백의 모양은 명세에 없다. 진행 상황 트리(2.6)의 STEP 노드에 필요한 값으로 정했다. */
export interface WebshellStep {
  id: string
  label: string
  status: StepStatus
  logRange: LogRange
}

// ── 진행 상황 트리 (명세 2.6, 4.9) ──────────────────────────

export type ProgressNodeType = 'REQUEST' | 'PLAN' | 'TASK' | 'APPROVAL' | 'STEP'
export type PlanNodeStatus = 'CURRENT' | 'SUPERSEDED'
export type ApprovalNodeStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

export interface ProgressRequestNode {
  id: string
  type: 'REQUEST'
  label: string
  status: RequestStatus
  children: ProgressNode[]
}

export interface ProgressPlanNode {
  id: string
  type: 'PLAN'
  label: string
  status: PlanNodeStatus
  /** 대체된 Plan은 접혀 있고 children이 비어 있다 */
  collapsed?: boolean
  /** 명세 2.6은 지금 Plan에만 보여 준다. TODO(spec): 대체된 Plan과 제출 전 값은 명세에 없어 없거나 null로 본다 */
  planHash?: string | null
  /** TODO(spec): 대체된 Plan을 펼쳤을 때 보여 줄 변경 이력. 명세의 children은 비어 있다 */
  supersededAt?: string
  supersededTasks?: Array<{ label: string; taskType: TaskType; risk?: Risk }>
  children: ProgressNode[]
}

export interface ProgressTaskNode {
  id: string
  type: 'TASK'
  label: string
  taskType: TaskType
  risk: Risk
  status: TaskStatus
  dependsOn: string[]
  children: ProgressNode[]
}

export interface ProgressApprovalNode {
  id: string
  type: 'APPROVAL'
  /** 승인 대기 중이면 없고 candidates가 있다 */
  label?: string
  status: ApprovalNodeStatus
  /** TODO(spec): 모양이 명세에 없다. 목은 결재 현황과 같은 { id, name }을 주고, requiredApprovers처럼 ID만 올 수도 있다. rule이 ANYONE이면 비어 있다 */
  candidates?: Array<{ id: string; name: string } | string>
  rule?: ApproverRule
  network?: Network
  at?: string
}

export interface ProgressStepNode {
  id: string
  type: 'STEP'
  label: string
  status: StepStatus
  logRange?: LogRange
}

export type ProgressNode =
  | ProgressRequestNode
  | ProgressPlanNode
  | ProgressTaskNode
  | ProgressApprovalNode
  | ProgressStepNode

export interface ProgressTree {
  requestId: string
  version: number
  updatedAt: string
  root: ProgressRequestNode
}

/** 값이 null인 속성은 지운다. 승인되면 candidates가 없어지고 label이 생긴다 */
export interface ProgressNodeUpdate {
  nodeId: string
  at: string
  status?: string
  label?: string | null
  [field: string]: unknown
}

/** id는 version이다. heartbeat는 버전을 올리지 않아 id가 없다 (명세 4.9) */
export type ProgressStreamEvent =
  | { id: number; event: 'node.updated'; data: ProgressNodeUpdate }
  | { id: number; event: 'node.added'; data: { parentId: string; node: ProgressNode } }
  | { id: number; event: 'tree.replaced'; data: { at: string } }
  | { id: null; event: 'heartbeat'; data: { at: string } }

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
// null은 서버가 주지 않아 모른다는 뜻이다. 0건과 구별해서 화면에 "-"로 보여 준다.
export interface Dashboard {
  scope: DashboardScope
  requestCount: number | null
  pendingApprovalCount: number | null
  riskDistribution: Record<Risk, number> | null
  statusCounts: Partial<Record<RequestStatus, number>> | null
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
  | 'AUDIT_EXPORTED'

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

// ── 감사 로그 내보내기 (CORE-13) ──────────────────────────

export type ExportFormat = 'CSV' | 'XLSX'
export type ExportStatus = 'PROCESSING' | 'READY' | 'FAILED' | 'EXPIRED'

/** GET /audit-logs의 검색 조건과 같다 */
export type AuditExportFilters = Omit<AuditLogQuery, 'cursor' | 'limit'>

export interface CreateAuditExportBody {
  format: ExportFormat
  filters: AuditExportFilters
}

export interface AuditExportAccepted {
  exportId: string
  status: ExportStatus
  format: ExportFormat
  rowCount: number
}

// TODO(spec): 명세의 상태 조회 예시는 READY뿐이고 목록 응답 모양은 없다. 목록도 같은 모양으로 두되 exportId·status 밖의 값은 없을 수 있다고 본다. createdAt은 명세에 없다.
export interface AuditExport {
  exportId: string
  status: ExportStatus
  format?: ExportFormat
  rowCount?: number
  fileName?: string
  createdAt?: string
  /** 준비된 뒤에만 값이 있다 */
  expiresAt?: string | null
  /** READY일 때만 값이 있다 */
  downloadUrl?: string | null
}
