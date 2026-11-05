import { downloadFile, downloadPdf, fetchPdf, http } from './client'
import { whenOnServer } from './missingOnServer'
import { streamMessages } from './sse'
import type {
  AcceptedRequest,
  AdminProof,
  AdminSigningKey,
  ApprovalContext,
  ApprovalDocumentVersion,
  ApplyPresetResponse,
  ApprovalMatrixResponse,
  ApprovalMatrixRule,
  AuditExport,
  AuditExportAccepted,
  AuditLog,
  AuditLogQuery,
  ChangeRequestStatus,
  CreateAuditExportBody,
  CreateRequestBody,
  CreateUserResponse,
  Dashboard,
  DashboardScope,
  Department,
  DocumentSummary,
  DocumentVersion,
  DocumentVersionSummary,
  EditorChangeBody,
  EditorChangeResponse,
  FileContent,
  FileListing,
  ForbiddenProposal,
  ForbiddenProposalConfirmResponse,
  ForbiddenProposalStatusResponse,
  ForbiddenProposalStatus,
  ForbiddenRule,
  ForbiddenRuleStatusResponse,
  KillAllResponse,
  KillResponse,
  LogLine,
  LoginResponse,
  Me,
  NotificationSettings,
  OtpEnrollResponse,
  Page,
  PatchPlanBody,
  PendingApproval,
  Policy,
  PolicyPreset,
  PlanRetryResponse,
  ProgressNode,
  ProgressStreamEvent,
  ProgressTree,
  Project,
  ProjectSpec,
  RegisterKeyResponse,
  RejectBody,
  RejectionResponse,
  RequestDetail,
  RequestStatus,
  RequestSummary,
  ResetPasswordResponse,
  Risk,
  Role,
  RollbackBody,
  RollbackResponse,
  SigningKey,
  SlackIntegration,
  SpecChangeRequest,
  SpecChangeRequestAccepted,
  SubmitApprovalBody,
  SubmitApprovalResponse,
  SubmitResponse,
  TaskDocument,
  TaskType,
  TokenResponse,
  UpdateApprovalMatrixResponse,
  User,
  WebshellPublicKey,
} from './types'

/** 명세 1.1: 목록은 기본 20건, 최대 100건이다. */
const MAX_LIMIT = 100
const MAX_PAGES = 50

/**
 * 화면이 전부 받았다고 믿는 목록(부서, 프로젝트, 계정, 승인 대기 등)은 nextCursor를 끝까지 따라간다.
 * 첫 쪽만 읽으면 21번째부터 조용히 사라진다. 상한을 넘기면 남은 커서를 그대로 돌려준다.
 */
async function allPages<T>(path: string, query?: Record<string, unknown>): Promise<Page<T>> {
  const items: T[] = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await http<Page<T>>('GET', path, { query: { ...query, cursor, limit: MAX_LIMIT } })
    items.push(...result.items)
    if (!result.nextCursor || result.nextCursor === cursor) return { items, nextCursor: null }
    cursor = result.nextCursor
  }
  return { items, nextCursor: cursor ?? null }
}

const withItems = <T, R>(page: Page<T>, change: (item: T) => R): Page<R> => ({ ...page, items: page.items.map(change) })

/** 명세에 없는 필드는 빠지거나 null로 올 수 있다. */
type Loose<T> = { [K in keyof T]?: T[K] | null }

/** 시스템 기록은 행위자, 접속 환경, IP가 비어 있다 (서버 AuditLog). 화면은 null만 다루면 되게 한다. */
function withAuditDefaults(raw: Pick<AuditLog, 'id' | 'at' | 'action'> & Loose<AuditLog>): AuditLog {
  return { ...raw, actor: raw.actor ?? null, target: raw.target ?? {}, network: raw.network ?? null, ip: raw.ip ?? null, detail: raw.detail ?? {} }
}

/** 서버 라벨은 "{order}. 제목"이고 AI 분석 Plan의 order는 0부터다. 화면 번호는 1부터 센다. order는 해시 대상이라 라벨만 바꾼다. */
function withTaskNumbers(children: ProgressNode[]): ProgressNode[] {
  let number = 0
  return children.map((child) => {
    if (child.type !== 'TASK') return child
    number += 1
    return { ...child, label: (child.label ?? '').replace(/^\d+\.\s*/, `${number}. `) }
  })
}

/**
 * 서버는 null 필드를 내려 주지 않아(ProgressNodeResponse) dependsOn이나 children이 빠질 수 있다. 화면은 항상 배열을 본다.
 * 서버의 승인 노드 ID는 approval:{승인 기록 id}라서 한 번에 여러 작업을 서명하면 작업마다 같은 ID가 나온다.
 * 화면은 ID로 노드를 찾고 선을 그리므로, 작업 ID를 앞에 붙여 트리 안에서 하나로 만든다.
 */
function withUniqueNodeIds<T extends ProgressNode>(node: T): T {
  if (node.type === 'APPROVAL' || node.type === 'STEP') return node
  const nodeChildren: ProgressNode[] = node.children ?? []
  if (node.type !== 'TASK') return { ...node, children: withTaskNumbers(nodeChildren).map(withUniqueNodeIds) }
  const children = nodeChildren.map((child) => (child.type === 'APPROVAL' ? { ...child, id: `${node.id}/${child.id}` } : child))
  return { ...node, label: node.label ?? '', dependsOn: node.dependsOn ?? [], children }
}

function withTreeIds(tree: ProgressTree): ProgressTree {
  return { ...tree, root: withUniqueNodeIds(tree.root) }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * SSE 메시지를 진행 상황 이벤트로 바꾼다. 서버는 node.updated, tree.replaced, heartbeat만 보낸다 (RequestStreamService).
 * 패치를 읽지 못하거나 버전을 모르면 변경을 잃지 않도록 전체를 다시 받게 한다. 모르는 이벤트는 버린다.
 */
export function toProgressEvent({ id, event, data }: { id: string | null; event: string; data: string }): ProgressStreamEvent | null {
  const parsed = id === null || id === '' ? Number.NaN : Number(id)
  const version = Number.isNaN(parsed) ? null : parsed
  const replaced = (): ProgressStreamEvent => ({ id: version ?? 0, event: 'tree.replaced', data: { version: version ?? 0 } })
  if (event === 'heartbeat') return { id: null, event, data: {} }
  if (event === 'tree.replaced') return replaced()
  if (event !== 'node.updated') return null
  const body = parseJson(data) as Record<string, unknown> | null
  if (version === null || typeof body?.nodeId !== 'string' || typeof body.status !== 'string') return replaced()
  return { id: version, event, data: { nodeId: body.nodeId, status: body.status, at: typeof body.at === 'string' ? body.at : '' } }
}

/** 없는 값을 기기에 고정하면 승인 서명을 암호화할 수 없으니 여기서 멈춘다. */
function requireWebshellKey(key: WebshellPublicKey): WebshellPublicKey {
  if (!key.encryption?.publicKey || !key.signing?.publicKey) throw new Error('웹쉘 공개키 응답에 필요한 값이 없습니다. 관리자에게 알려 주세요')
  return key
}

/** 서버는 승인 키로 이 알고리즘만 받는다. */
const SIGNING_KEY_ALGORITHM = 'Ed25519'

const NO_RISKS: Record<Risk, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, FORBIDDEN: 0 }

/** 집계가 빠졌을 때 0으로 채우면 "실행 중 0건"이라는 거짓말이 되므로 모르는 값은 null로 두고 화면이 모른다고 표시한다. */
function withDashboardDefaults(raw: Pick<Dashboard, 'scope'> & Loose<Dashboard>): Dashboard {
  return {
    ...raw,
    requestCount: raw.requestCount ?? null,
    pendingApprovalCount: raw.pendingApprovalCount ?? null,
    riskCounts: raw.riskCounts ? { ...NO_RISKS, ...raw.riskCounts } : null,
    statusCounts: raw.statusCounts ?? null,
    byDepartment: raw.byDepartment ?? undefined,
  }
}

export const authApi = {
  login: (employeeNumber: string, password: string) =>
    http<LoginResponse>('POST', '/auth/login', { body: { employeeNumber, password }, skipRefresh: true }),
  verifyOtp: (temporaryToken: string, otpCode: string) =>
    http<TokenResponse>('POST', '/auth/otp/verify', { body: { temporaryToken, otpCode }, skipRefresh: true }),
  refresh: () => http<TokenResponse>('POST', '/auth/refresh', { skipRefresh: true }),
  logout: () => http<void>('POST', '/auth/logout', { skipRefresh: true }),
}

export const meApi = {
  get: () => http<Me>('GET', '/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    http<void>('PUT', '/me/password', { body: { currentPassword, newPassword } }),
  /** 서버는 otpCode가 없거나 비어 있으면 비밀키를 새로 발급해 앱에 넣은 키를 덮어쓴다. 그래서 발급과 확인을 나눠 둔다. */
  issueOtpSecret: () => http<OtpEnrollResponse>('POST', '/me/otp'),
  confirmOtp: async (otpCode: string) => {
    if (!otpCode.trim()) throw new Error('OTP 번호를 입력해 주세요')
    const result = await http<OtpEnrollResponse>('POST', '/me/otp', { body: { otpCode } })
    if (!result.verified) throw new Error('OTP 등록을 확인하지 못했습니다. 다시 등록해 주세요')
    return result
  },
  submitSigningKey: (publicKey: string) =>
    http<SigningKey>('POST', '/me/signing-keys', { body: { algorithm: SIGNING_KEY_ALGORITHM, publicKey } }),
  signingKeys: () => allPages<SigningKey>('/me/signing-keys'),
  webshellPublicKey: () => http<WebshellPublicKey>('GET', '/webshell/public-key').then(requireWebshellKey),
  notificationSettings: () => whenOnServer(http<NotificationSettings>('GET', '/me/notification-settings')),
  updateNotificationSettings: (body: NotificationSettings) =>
    whenOnServer(http<NotificationSettings>('PUT', '/me/notification-settings', { body })),
}

export const adminApi = {
  users: (query?: { departmentId?: string; role?: Role }) => allPages<User>('/admin/users', query),
  createUser: (body: { employeeNumber: string; name: string; role: Role; departmentId: string | null }) =>
    http<CreateUserResponse>('POST', '/admin/users', { body }),
  /** 서버는 null을 "바꾸지 않음"으로 읽는다. 부서를 비울 수는 없다. */
  updateUser: (userId: string, body: Partial<Pick<User, 'role' | 'departmentId' | 'active'>>) =>
    http<User>('PATCH', `/admin/users/${userId}`, { body }),
  resetPassword: (userId: string) =>
    http<ResetPasswordResponse>('POST', `/admin/users/${userId}/reset-password`),
  createDepartment: (name: string) => http<Department>('POST', '/admin/departments', { body: { name } }),
  policy: () => http<Policy>('GET', '/admin/policy'),
  applyPreset: (preset: PolicyPreset, adminProof: AdminProof) =>
    http<ApplyPresetResponse>('PUT', '/admin/policy/preset', { body: { preset, adminProof } }),
  updateMatrix: (rules: ApprovalMatrixRule[], adminProof: AdminProof) =>
    http<UpdateApprovalMatrixResponse>('PUT', '/admin/approval-matrix', { body: { rules, adminProof } }),
  signingKeys: () => allPages<AdminSigningKey>('/admin/signing-keys'),
  registerKey: (keyId: string, adminProof: AdminProof) =>
    http<RegisterKeyResponse>('POST', `/admin/signing-keys/${keyId}/register`, { body: { adminProof } }),
  /** 등록된 키는 adminProof가 필수이고, 등록 대기 키는 본문 없이 폐기한다 (서버 SigningKeyCommandService.revoke) */
  revokeKey: (keyId: string, adminProof?: AdminProof) =>
    http<void>('DELETE', `/admin/signing-keys/${keyId}`, adminProof ? { body: { adminProof } } : undefined),
  updateSlack: (body: SlackIntegration) => whenOnServer(http<SlackIntegration>('PUT', '/admin/integrations/slack', { body })),
  killAll: (reason: string) => http<KillAllResponse>('POST', '/admin/kill-all', { body: { reason } }),
  createProject: (body: {
    name: string
    departmentId: string
    repository: string
    ownerIds: string[]
    initialSpec: { body: string }
  }) => http<Project>('POST', '/admin/projects', { body }),
}

export const orgApi = {
  departments: () => allPages<Department>('/departments'),
  approvalMatrix: () => http<ApprovalMatrixResponse>('GET', '/approval-matrix'),
}

export const projectsApi = {
  list: () => allPages<Project>('/projects'),
  get: (projectId: string) => http<Project>('GET', `/projects/${projectId}`),
  spec: (projectId: string) => http<ProjectSpec>('GET', `/projects/${projectId}/spec`),
  updateSpec: (projectId: string, body: string) =>
    http<ProjectSpec>('PUT', `/projects/${projectId}/spec`, { body: { body } }),
  specVersions: (projectId: string) => allPages<ProjectSpec>(`/projects/${projectId}/spec/versions`),
  /** 사유는 선택이다. 없으면 본문 없이 보낸다 (서버 SpecRestoreRequest) */
  restoreSpec: (projectId: string, version: number, reason?: string) =>
    http<ProjectSpec>('POST', `/projects/${projectId}/spec/versions/${version}/restore`, reason?.trim() ? { body: { reason: reason.trim() } } : undefined),
  updateOwners: (projectId: string, ownerIds: string[]) =>
    whenOnServer(http<Project>('PUT', `/projects/${projectId}/owners`, { body: { ownerIds } })),
  createChangeRequest: (projectId: string, body: { content: string; reason: string }) =>
    http<SpecChangeRequest>('POST', `/projects/${projectId}/spec/change-requests`, { body }),
  changeRequests: (projectId: string, status?: ChangeRequestStatus) =>
    allPages<SpecChangeRequest>(`/projects/${projectId}/spec/change-requests`, { status }),
  acceptChangeRequest: (projectId: string, crId: string) =>
    http<SpecChangeRequestAccepted>('POST', `/projects/${projectId}/spec/change-requests/${crId}/accept`),
  rejectChangeRequest: (projectId: string, crId: string, reason: string) =>
    http<SpecChangeRequest>('POST', `/projects/${projectId}/spec/change-requests/${crId}/reject`, { body: { reason } }),
}

export interface ForbiddenInput {
  taskType: TaskType
  target: string
  reason: string
}

export const forbiddenApi = {
  rules: (deptId: string) => allPages<ForbiddenRule>(`/departments/${deptId}/forbidden-rules`),
  propose: (deptId: string, body: ForbiddenInput) =>
    http<ForbiddenProposal>('POST', `/departments/${deptId}/forbidden-proposals`, { body }),
  proposals: (status?: ForbiddenProposalStatus) =>
    allPages<ForbiddenProposal>('/admin/forbidden-proposals', { status }),
  confirm: (proposalId: string, adminProof: AdminProof) =>
    http<ForbiddenProposalConfirmResponse>('POST', `/admin/forbidden-proposals/${proposalId}/confirm`, { body: { adminProof } }),
  reject: (proposalId: string, reason: string) =>
    http<ForbiddenProposalStatusResponse>('POST', `/admin/forbidden-proposals/${proposalId}/reject`, { body: { reason } }),
  addRule: (body: ForbiddenInput & { departmentId: string; adminProof: AdminProof }) =>
    http<ForbiddenRule>('POST', '/admin/forbidden-rules', { body }),
  /** adminProof가 없으면 서버는 요청만 저장하고, 다음 서명된 정책 변경 때 웹쉘에 보낸다 */
  release: (ruleId: string, body: { reason: string; adminProof?: AdminProof }) =>
    http<ForbiddenRuleStatusResponse>('POST', `/admin/forbidden-rules/${ruleId}/release`, { body }),
}

export const requestsApi = {
  create: (body: CreateRequestBody) => http<AcceptedRequest>('POST', '/requests', { body }),
  list: (query?: { mine?: boolean; status?: RequestStatus; projectId?: string; cursor?: string; limit?: number }) =>
    http<Page<RequestSummary>>('GET', '/requests', { query }),
  /** 화면이 건수나 전체를 믿어야 할 때만 쓴다 (전사 일괄 중단 대상 등) */
  listAll: (query?: { mine?: boolean; status?: RequestStatus; projectId?: string }) => allPages<RequestSummary>('/requests', query),
  get: (requestId: string) => http<RequestDetail>('GET', `/requests/${requestId}`),
  retryAnalysis: (requestId: string) => http<AcceptedRequest>('POST', `/requests/${requestId}/analysis/retry`),
  patchPlan: (requestId: string, body: PatchPlanBody) =>
    http<AcceptedRequest>('PATCH', `/requests/${requestId}/plan`, { body }),
  submit: (requestId: string) => http<SubmitResponse>('POST', `/requests/${requestId}/submit`),
  cancel: (requestId: string) => http<AcceptedRequest>('POST', `/requests/${requestId}/cancel`),
  kill: (requestId: string, reason: string) =>
    http<KillResponse>('POST', `/requests/${requestId}/kill`, { body: { reason } }),
  retryFailed: (requestId: string) => http<PlanRetryResponse>('POST', `/requests/${requestId}/retry`),
  logs: (requestId: string, query?: { cursor?: string; limit?: number }) =>
    http<Page<LogLine>>('GET', `/requests/${requestId}/logs`, { query }),
  /** 이벤트 이름은 log이고 id가 없으며 지난 줄을 다시 보내지 않는다. 연결 유지는 SSE 주석이라 메시지로 오지 않는다 (RequestStreamService) */
  streamLogs: (requestId: string, onLine: (line: LogLine) => void, signal: AbortSignal, onOpen?: () => void) =>
    streamMessages(
      `/requests/${requestId}/logs/stream`,
      ({ event, data }) => {
        if (event !== 'log') return
        const line = parseJson(data) as LogLine | null
        if (typeof line?.sequence === 'number') onLine(line)
      },
      signal,
      undefined,
      onOpen,
    ),
  progress: (requestId: string) => http<ProgressTree>('GET', `/requests/${requestId}/progress`).then(withTreeIds),
  /** lastVersion을 주면 Last-Event-ID로 보낸다. 서버는 지난 이벤트를 다시 보내지 않고, 버전이 다르면 tree.replaced를 보낸다 */
  streamProgress: (
    requestId: string,
    onEvent: (event: ProgressStreamEvent) => void,
    signal: AbortSignal,
    lastVersion?: number,
  ) =>
    streamMessages(
      `/requests/${requestId}/progress/stream`,
      (message) => {
        const event = toProgressEvent(message)
        if (event) onEvent(event)
      },
      signal,
      lastVersion === undefined ? undefined : String(lastVersion),
    ),
  taskDocument: (requestId: string, taskId: string) =>
    http<TaskDocument>('GET', `/requests/${requestId}/tasks/${taskId}/document`),
  rollback: (requestId: string, body: RollbackBody) =>
    http<RollbackResponse>('POST', `/requests/${requestId}/rollback`, { body }),
}

export const approvalsApi = {
  pending: () => allPages<PendingApproval>('/approvals/pending'),
  context: (requestId: string) => http<ApprovalContext>('GET', `/requests/${requestId}/approval-context`),
  submit: (requestId: string, body: SubmitApprovalBody) =>
    http<SubmitApprovalResponse>('POST', `/requests/${requestId}/approvals`, { body }),
  reject: (requestId: string, body: RejectBody) =>
    http<RejectionResponse>('POST', `/requests/${requestId}/rejections`, { body }),
}

/**
 * 승인 기록 문서. whenOnServer로 감싸지 않는다. 이 경로의 404는 "문서가 아직 없음"이라는 진짜 답이기도 해서,
 * 경로가 없을 때와 구분할 수 없다. 화면은 404를 "아직 문서가 없다"로 읽는다.
 */
export const approvalDocumentApi = {
  /** 화면은 판 번호와 내용이 어긋나지 않게 version을 쓴다. 명세의 최신 판 경로라 함께 둔다 */
  latest: (requestId: string) => fetchPdf(`/requests/${requestId}/approval-document`),
  versions: (requestId: string) => allPages<ApprovalDocumentVersion>(`/requests/${requestId}/approval-document/versions`),
  version: (requestId: string, version: number, signal?: AbortSignal) =>
    fetchPdf(`/requests/${requestId}/approval-document/versions/${version}`, signal),
  download: (requestId: string) => downloadPdf(`/requests/${requestId}/approval-document/pdf`, `approval-document-${requestId}.pdf`),
}

export const documentsApi = {
  list: (projectId: string) => allPages<DocumentSummary>(`/projects/${projectId}/documents`),
  versions: (documentId: string) => allPages<DocumentVersionSummary>(`/documents/${documentId}/versions`),
  version: (documentId: string, version: number) => http<DocumentVersion>('GET', `/documents/${documentId}/versions/${version}`),
  /** 지금 적용된 버전. 문서 한 건을 읽는 API가 없어 프로젝트의 문서 목록에서 currentVersion을 찾는다 */
  current: async (projectId: string, documentId: string) => {
    const { items } = await documentsApi.list(projectId)
    const document = items.find((item) => item.id === documentId)
    if (!document) throw new Error('문서를 찾을 수 없습니다')
    return documentsApi.version(documentId, document.currentVersion)
  },
}

export const editorApi = {
  files: (projectId: string, query?: { path?: string; ref?: string }) =>
    http<FileListing>('GET', `/projects/${projectId}/files`, { query }),
  content: (projectId: string, query: { path: string; ref?: string }) =>
    http<FileContent>('GET', `/projects/${projectId}/files/content`, { query }),
  save: (projectId: string, body: EditorChangeBody) =>
    http<EditorChangeResponse>('POST', `/projects/${projectId}/editor/changes`, { body }),
}

export const dashboardApi = {
  get: (scope: DashboardScope, departmentId?: string) =>
    http<Dashboard>('GET', '/dashboard', { query: { scope, departmentId } }).then(withDashboardDefaults),
}

export const auditApi = {
  list: (query: AuditLogQuery) =>
    http<Page<AuditLog>>('GET', '/audit-logs', { query: { ...query } }).then((page) => withItems(page, withAuditDefaults)),
  get: (logId: string) => http<AuditLog>('GET', `/audit-logs/${logId}`).then(withAuditDefaults),
}

export const auditExportApi = {
  create: (body: CreateAuditExportBody) => http<AuditExportAccepted>('POST', '/audit-logs/exports', { body }),
  list: () => http<Page<AuditExport>>('GET', '/audit-logs/exports'),
  get: (exportId: string) => http<AuditExport>('GET', `/audit-logs/exports/${exportId}`),
  download: (exportId: string, fileName: string) => downloadFile(`/audit-logs/exports/${exportId}/file`, fileName),
}
