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
  employeeNumber: string
  role: Role
  active: boolean
}

/** OTP 등록 여부와 키 대기 상태는 서버가 알려 주지 않는다. 키 상태는 GET /me/signing-keys로 본다. */
export interface Me extends User {
  network: Network
  passwordChangeRequired: boolean
  hasRegisteredSigningKey: boolean
}

export interface Department {
  id: string
  name: string
}

export interface LoginResponse {
  otpRequired: boolean
  /** 외부망이면 OTP 확인에 쓰는 임시 토큰 */
  temporaryToken?: string
  accessToken?: string
  passwordChangeRequired?: boolean
}

export interface TokenResponse {
  accessToken: string
}

/** POST /me/otp. 발급 단계에는 secret과 otpauthUri가 오고, 확인을 마치면 verified만 온다. */
export interface OtpEnrollResponse {
  secret?: string
  otpauthUri?: string
  verified: boolean
}

export interface SigningKey {
  id: string
  algorithm: string
  publicKey: string
  status: SigningKeyStatus
  createdAt: string
}

export interface AdminSigningKey extends SigningKey {
  userId: string
}

/** 관리자 서명. 서명 대상은 API마다 다르다. */
export interface AdminProof {
  keyId: string
  signature?: string
}

export interface RegisterKeyResponse {
  keyId: string
  status: SigningKeyStatus
  policyVersion: number
}

export interface ResetPasswordResponse {
  userId: string
  initialPassword: string
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

export interface ProjectOwner {
  id: string
  name: string
}

export interface Project {
  id: string
  name: string
  departmentId: string
  repository: string
  owners: ProjectOwner[]
}

export interface ProjectSpec {
  projectId: string
  version: number
  body: string
  createdAt: string
  /** 저장한 사람의 ID. 서버는 이름을 주지 않는다 */
  createdBy: string
  /** 복원으로 만든 버전이면 원본 버전 */
  restoredFromVersion: number | null
}

export type ChangeRequestStatus = 'OPEN' | 'ACCEPTED' | 'REJECTED'

export interface SpecChangeRequest {
  id: string
  projectId: string
  content: string
  reason: string
  requesterId: string
  status: ChangeRequestStatus
  rejectionReason: string | null
  createdAt: string
}

export interface SpecChangeRequestAccepted {
  changeRequest: SpecChangeRequest
  spec: ProjectSpec
}

// ── 정책·승인 기준표 ───────────────────────────────────────

export interface Policy {
  preset: PolicyPreset
  version: number
  approvalMatrix: ApprovalMatrixRule[]
  policyHash: string
  /** 서버에 없는 값이다 (api/missingOnServer.ts). 목만 준다. 없으면 Slack 화면이 아직 없는 기능이라고 말한다 */
  slackIntegration?: SlackIntegration | null
}

export interface ApplyPresetResponse {
  preset: PolicyPreset
  policyVersion: number
  webshellApplied: boolean
}

export interface SlackIntegration {
  workspace: string
  defaultChannel: string
}

/** 작업 유형·위험도별 필요한 승인권자. 서버 기준표에 모든 유형이 있지는 않다 */
export interface ApprovalMatrixRule {
  taskType: TaskType
  risk: Risk
  requiredApprovers: ApproverRequirement[]
}

export interface ApprovalMatrixResponse {
  rules: ApprovalMatrixRule[]
}

export interface UpdateApprovalMatrixResponse {
  policyVersion: number
  webshellApplied: boolean
  rules: ApprovalMatrixRule[]
}

export interface KillAllResponse {
  status: string
  executionIds: string[]
}

// ── 금지 작업 ──────────────────────────────────────────────

export type ForbiddenRuleStatus = 'CONFIRMED' | 'RELEASE_PENDING'
export type ForbiddenProposalStatus = 'OPEN' | 'CONFIRMED' | 'REJECTED'

export interface ForbiddenRule {
  id: string
  departmentId: string
  taskType: TaskType
  target: string
  reason: string
  status: ForbiddenRuleStatus
}

export interface ForbiddenRuleStatusResponse {
  ruleId: string
  status: ForbiddenRuleStatus
}

export interface ForbiddenProposal {
  id: string
  departmentId: string
  taskType: TaskType
  target: string
  reason: string
  status: ForbiddenProposalStatus
}

export interface ForbiddenProposalStatusResponse {
  proposalId: string
  status: ForbiddenProposalStatus
}

export interface ForbiddenProposalConfirmResponse extends ForbiddenProposalStatusResponse {
  rule: ForbiddenRule
  policyVersion: number
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
 * TODO(spec): 서버 TaskResponse에 없는 목 전용 필드. 승인권자가 코드를 읽지 않아도 이해하도록 AI가 풀어 쓴 설명이다.
 * 서버 응답에는 없어서 화면이 content에서 직접 풀어 쓴다 (lib/explain.ts). Plan 해시 대상이 아니므로 서명 기준은 항상 content다.
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
  target: string
  content: TaskContent
  relatedDepartments: string[]
  requiredApprovers: ApproverRequirement[]
  status: TaskStatus
  // TODO(spec): 아래는 서버 TaskResponse에 없는 목 전용 필드다. 서버 응답이면 없다.
  description?: string
  /** AI가 기본 위험도보다 올렸을 때만 있음 */
  riskRaised?: { from: Risk; reason: string }
  forbiddenReason?: string
  explanation?: TaskExplanation
}

export interface Plan {
  id: string
  requestId: string
  kind: PlanKind
  repository: string
  baseCommit: string
  /** 웹 서비스가 만든 표시용 값. 승인자 기기와 웹쉘은 믿지 않고 각자 다시 계산한다 (명세 2.2, 2.3) */
  planHash: string | null
  tasks: Task[]
}

/**
 * 서명 대상. 서버 PlanHashService.hashTarget과 같은 모양이다.
 * 금지 작업은 빠지고 작업은 order 순이며, content의 null 필드는 없다.
 */
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

/** 요청 상세의 승인 현황 한 건 (서버 ApprovalResponse). 현재 Plan의 승인만 온다. 봉투는 내려 주지 않는다 */
export interface RequestApproval {
  id: string
  planId: string
  approverId: string
  taskIds: string[]
  network: Network
  createdAt: string
}

/** 결재란에 찍는 한 사람의 승인. 서버 응답이 아니라 requiredApprovers와 approvals로 화면이 계산한 값이다 (lib/approvalStatus.ts). */
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
  /** 서버는 후보를 UUID로만 준다. 모두 이름을 알 때만 채우고, 아니면 비어 있다 */
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

export interface RequestDetail extends RequestSummary {
  /** 분석 전이면 null이다 */
  currentPlan: Plan | null
  approvals: RequestApproval[]
  /** AI 확인 질문. 없으면 null이다 */
  clarification: string | null
  // TODO(spec): 아래는 서버 RequestDetailResponse에 없는 목 전용 필드다. 서버 응답이면 없고, 화면은 없을 때 모른다고 말한다.
  /** 재승인 화면에서 강조할 바뀐 작업 */
  changedTaskIds?: string[]
  removedTaskTitles?: string[]
  /** 웹쉘 검증 실패 항목. 없으면 관문이 검사별 결과를 말하지 않는다 */
  failedChecks?: FailedCheck[]
  /** 변조 시연 전용: 평문 approvals와 달리 실제 서명 봉투가 있는 기록의 개수. 없으면 approvals 개수로 본다 */
  approvalRecordCount?: number
  rejection?: { by: string; reason: string; at: string; taskIds: string[] } | null
  kill?: { by: string; reason: string; at: string } | null
  events?: RequestEvent[]
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

/** 실패 작업 재시도 응답 (서버 PlanRetryResponse). 새 Plan을 만들 뿐 제출 응답과 달리 본인 승인 목록이 없다 */
export interface PlanRetryResponse {
  id: string
  status: RequestStatus
  planId: string
  planHash: string
}

// ── 승인 (명세 2.4, 2.5, 4.4, 4.5) ──────────────────────────

export interface ApprovalContext {
  requestId: string
  /** 화면에 보여 줄 Plan. hashTarget과 내용이 같을 때만 서명한다 */
  plan: Plan
  planHash: string
  /** 해시를 직접 다시 계산할 대상 (명세 2.3) */
  hashTarget: PlanHashTarget
  approvableTaskIds: string[]
  blockedTaskIds: string[]
  /** 서버 문자열이다. 지금은 INTERNAL_NETWORK_ONLY만 온다 */
  blockedReason: string | null
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
  planId: string
  taskIds: string[]
  reason?: string
}

export interface RejectionResponse {
  requestId: string
  status: RequestStatus
}

/** 내 승인 대기 작업 한 건. 프로젝트와 내부망 차단 여부는 없다. 차단은 승인 자료에서만 알 수 있다 */
export interface PendingApproval {
  requestId: string
  planId: string
  requester: UserRef
  /** 요청을 만든 시각이다 */
  requestedAt: string
  task: Task
}

export interface KillResponse {
  id: string
  status: RequestStatus
  skippedTaskIds: string[]
}

/** 실행 로그 한 줄 (서버 ExecutionLogResponse). sequence는 실행 세션 안에서만 유일하다 */
export interface LogLine {
  sequence: number
  at: string
  taskId: string | null
  message: string
  /** TODO(spec): 웹쉘 서명. 서명 대상의 모양은 서버 코드에도 없다. 서버는 받은 값을 그대로 내려 준다 */
  webshellSignature: string
}

// ── 웹쉘 (명세 5장) ────────────────────────────────────────

/** publicKey는 표준 base64, fingerprint는 "sha256:" + base64를 푼 바이트의 SHA-256 hex다. */
export interface WebshellKeyInfo {
  algorithm: string
  publicKey: string
  fingerprint: string
}

export interface WebshellPublicKey {
  /** 승인 서명 암호화용 X25519 */
  encryption: WebshellKeyInfo
  /** 실행 결과·로그 확인용 Ed25519 */
  signing: WebshellKeyInfo
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

/** 실행 로그 sequence 구간. 아직 진행 중이면 to가 null이다 (명세 2.6) */
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
export type ApprovalNodeStatus = 'PENDING' | 'APPROVED'

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
  /** 승인한 사람의 이름. 승인 대기 중이면 없다 */
  label?: string
  status: ApprovalNodeStatus
  /** 승인 후보의 사용자 ID. 후보 목록이 없는 규칙(누구나)이면 없다 */
  candidates?: string[]
  network?: Network
  at?: string
}

/** TODO(spec): 서버는 아직 STEP 노드를 보내지 않는다(웹쉘 콜백 계약 전). 목의 시연에서만 나온다 */
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

/** 노드 하나의 상태가 바뀌었다는 알림 (서버 publishNodeUpdated) */
export interface ProgressNodeUpdate {
  nodeId: string
  status: string
  at: string
}

/** id는 version이다. heartbeat는 버전을 올리지 않아 id가 없다. 서버는 이 세 이벤트만 보낸다 (RequestStreamService) */
export type ProgressStreamEvent =
  | { id: number; event: 'node.updated'; data: ProgressNodeUpdate }
  | { id: number; event: 'tree.replaced'; data: { version: number } }
  | { id: null; event: 'heartbeat'; data: Record<string, never> }

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

// ── 승인 기록 문서 ─────────────────────────────────────────

export type ApprovalDocumentStatus = 'IN_PROGRESS' | 'APPROVED' | 'REVISING' | 'SUPERSEDED' | 'REJECTED' | 'CANCELED' | 'KILLED'

/** 서버는 문서 내용을 JSON으로 주지 않는다. 내용은 판별 미리보기 PDF로 본다. */
export interface ApprovalDocumentVersion {
  documentId: string
  version: number
  planId: string
  planHash: string
  status: ApprovalDocumentStatus
  /** status가 APPROVED일 때만 true */
  downloadable: boolean
  createdAt: string
}

// ── 에디터 ─────────────────────────────────────────────────

export interface FileEntry {
  name: string
  path: string
  type: 'FILE' | 'DIR'
}

export interface FileListing {
  path: string
  baseCommit: string
  items: FileEntry[]
}

export interface FileContent {
  path: string
  ref: string
  baseCommit: string
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
