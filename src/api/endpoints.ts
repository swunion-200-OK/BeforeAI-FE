import { downloadFile, http } from './client'
import { streamMessages } from './sse'
import type {
  AcceptedRequest,
  ApprovalContext,
  ApprovalMatrixRow,
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
  ForbiddenProposalStatus,
  ForbiddenRule,
  KillResponse,
  LogLine,
  LoginResponse,
  Me,
  NotificationSettings,
  Page,
  PatchPlanBody,
  PendingApproval,
  Policy,
  PolicyPreset,
  ProgressNode,
  ProgressRequestNode,
  ProgressStreamEvent,
  ProgressTree,
  Project,
  ProjectSpec,
  RejectBody,
  RequestDetail,
  RequestStatus,
  RequestSummary,
  Risk,
  Role,
  RollbackBody,
  SigningKey,
  SlackIntegration,
  SpecChangeRequest,
  SubmitApprovalBody,
  SubmitApprovalResponse,
  SubmitResponse,
  TaskApprovalStatus,
  TaskDocument,
  TaskType,
  TokenResponse,
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

/** 사람 정보가 빠졌을 때 화면이 깨지지 않게 하는 자리 값. 지어낸 이름 대신 모른다고 쓴다. */
const UNKNOWN_USER = { id: '', name: '알 수 없음', departmentId: null }

/** TODO(spec): 목록에 담당자가 오는지 명세에 없다 (3.3은 상세에만 "담당자 포함"). 없으면 비워 둔다. */
function withProjectDefaults(project: Omit<Project, 'owners'> & Loose<Pick<Project, 'owners'>>): Project {
  return { ...project, owners: project.owners ?? [] }
}

/** TODO(spec): 기획서 응답 모양은 명세에 없다. */
function withSpecDefaults(spec: Omit<ProjectSpec, 'updatedBy'> & Loose<Pick<ProjectSpec, 'updatedBy'>>): ProjectSpec {
  return { ...spec, updatedBy: spec.updatedBy ?? UNKNOWN_USER }
}

function withChangeRequestDefaults(item: Omit<SpecChangeRequest, 'requester'> & Loose<Pick<SpecChangeRequest, 'requester'>>): SpecChangeRequest {
  return { ...item, requester: item.requester ?? UNKNOWN_USER }
}

function withVersionDefaults<T extends { createdBy?: DocumentVersionSummary['createdBy'] | null }>(version: T) {
  return { ...version, createdBy: version.createdBy ?? UNKNOWN_USER }
}

/** TODO(spec): 명세는 "위험도·요청자·요청 시각"만 약속한다 (3.6). */
function withPendingDefaults(item: Omit<PendingApproval, 'taskTitle' | 'projectName' | 'requester' | 'blockedReason'> & Loose<PendingApproval>): PendingApproval {
  return {
    ...item,
    taskTitle: item.taskTitle ?? '제목 없는 작업',
    projectName: item.projectName ?? item.projectId,
    requester: item.requester ?? UNKNOWN_USER,
    blockedReason: item.blockedReason ?? null,
  }
}

/** 승인 현황의 모양은 명세에 없다. 충족 여부를 모르면 충족으로 보지 않는다. ID만 온 후보는 보여 줄 이름이 없어 뺀다. */
function withApprovalStatusDefaults(status: TaskApprovalStatus): TaskApprovalStatus {
  return {
    ...status,
    requirements: (status.requirements ?? []).map((item) => ({
      ...item,
      candidates: (item.candidates ?? []).filter((candidate) => Boolean(candidate?.name)),
      approvedBy: item.approvedBy ?? [],
      satisfied: item.satisfied === true,
    })),
  }
}

type RawRequestDetail = RequestSummary &
  Loose<Omit<RequestDetail, keyof RequestSummary | 'clarification'>> & {
    /** 명세 4.1은 "clarification 필드에 질문이 담기고"라고만 해서 문자열로 올 수도 있다 */
    clarification?: RequestDetail['clarification'] | string
  }

/** TODO(spec): 요청 상세의 추가 필드는 명세에 없다 (types.ts). 빠지거나 null이어도 화면이 깨지지 않게 여기서 채운다. */
function withDetailDefaults(detail: RawRequestDetail): RequestDetail {
  const { clarification } = detail
  return {
    ...detail,
    projectName: detail.projectName ?? detail.projectId,
    plan: detail.plan ?? null,
    approvalStatus: (detail.approvalStatus ?? []).map(withApprovalStatusDefaults),
    clarification: typeof clarification === 'string' ? { question: clarification } : (clarification ?? null),
    analysisError: detail.analysisError ?? null,
    changedTaskIds: detail.changedTaskIds ?? [],
    removedTaskTitles: detail.removedTaskTitles ?? [],
    failedChecks: detail.failedChecks ?? [],
    approvalRecordCount: detail.approvalRecordCount ?? undefined,
    rejection: detail.rejection ?? null,
    kill: detail.kill ?? null,
    events: detail.events ?? [],
  }
}

/** TODO(spec): 재시도·롤백 응답 모양은 명세에 없다 (3.5, 3.7). 제출 응답(4.3)과 같다고 보되, 상태를 이미 바꾼 뒤 여기서 터지지 않게 한다. */
function withSubmitDefaults(requestId: string, result: Omit<SubmitResponse, 'id' | 'selfApprovableTaskIds'> & Loose<SubmitResponse>): SubmitResponse {
  return { ...result, id: result.id ?? requestId, selfApprovableTaskIds: result.selfApprovableTaskIds ?? [] }
}

/** 명세 2.6의 예시에서도 STEP과 APPROVAL에는 children이 없다. 나머지 노드는 비어 있어도 배열로 맞춘다. */
function withNodeDefaults(node: ProgressNode): ProgressNode {
  if (node.type === 'APPROVAL' || node.type === 'STEP') return node
  const children = (node.children ?? []).map(withNodeDefaults)
  return node.type === 'TASK' ? { ...node, children, dependsOn: node.dependsOn ?? [] } : { ...node, children }
}

function withTreeDefaults(tree: ProgressTree): ProgressTree {
  return { ...tree, root: withNodeDefaults(tree.root) as ProgressRequestNode }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * SSE 메시지를 진행 상황 이벤트로 바꾼다 (명세 4.9). heartbeat와 tree.replaced는 본문이 명세에 없어 비어 있어도 된다.
 * 패치를 읽지 못하거나 버전을 모르면 변경을 잃지 않도록 전체를 다시 받게 한다. 모르는 이벤트는 버린다.
 */
export function toProgressEvent({ id, event, data }: { id: string | null; event: string; data: string }): ProgressStreamEvent | null {
  const parsed = id === null || id === '' ? Number.NaN : Number(id)
  const version = Number.isNaN(parsed) ? null : parsed
  const body = parseJson(data) as Record<string, unknown> | null
  const at = typeof body?.at === 'string' ? body.at : ''
  if (event === 'heartbeat') return { id: null, event, data: { at } }
  if (event === 'tree.replaced') return { id: version ?? 0, event, data: { at } }
  if (event !== 'node.updated' && event !== 'node.added') return null
  if (version === null || !body) return { id: version ?? 0, event: 'tree.replaced', data: { at } }
  if (event === 'node.added') {
    if (typeof body.parentId !== 'string' || !body.node) return { id: version, event: 'tree.replaced', data: { at } }
    return { id: version, event, data: { parentId: body.parentId, node: withNodeDefaults(body.node as ProgressNode) } }
  }
  if (typeof body.nodeId !== 'string') return { id: version, event: 'tree.replaced', data: { at } }
  return { id: version, event, data: { ...body, nodeId: body.nodeId, at } }
}

/** TODO(spec): 승인 기준표 응답 모양은 명세에 없다 (3.2). 표 그대로, { rows }, 목록 규칙(1.1)의 { items } 모두 받는다. */
function toMatrixRows(result: ApprovalMatrixRow[] | { rows?: ApprovalMatrixRow[]; items?: ApprovalMatrixRow[] }): ApprovalMatrixRow[] {
  return Array.isArray(result) ? result : (result.rows ?? result.items ?? [])
}

/** TODO(spec): 필드 이름은 명세에 없다. 없는 값을 기기에 고정하면 승인 서명을 암호화할 수 없으니 여기서 멈춘다. */
function requireWebshellKey(key: WebshellPublicKey): WebshellPublicKey {
  if (!key.encryptionKey || !key.signingKey) throw new Error('웹쉘 공개키 응답에 필요한 값이 없습니다. 관리자에게 알려 주세요')
  return key
}

const NO_RISKS: Record<Risk, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, FORBIDDEN: 0 }

/**
 * TODO(spec): 대시보드 필드 이름은 명세에 없다 (3.9). 집계가 빠졌을 때 0으로 채우면 "실행 중 0건"이라는 거짓말이 되므로
 * 모르는 값은 null로 두고 화면이 모른다고 표시한다.
 */
function withDashboardDefaults(raw: Pick<Dashboard, 'scope'> & Loose<Dashboard>): Dashboard {
  return {
    ...raw,
    requestCount: raw.requestCount ?? null,
    pendingApprovalCount: raw.pendingApprovalCount ?? null,
    riskDistribution: raw.riskDistribution ? { ...NO_RISKS, ...raw.riskDistribution } : null,
    statusCounts: raw.statusCounts ?? null,
    byDepartment: raw.byDepartment ?? undefined,
  }
}

/** TODO(spec): 디렉터리 목록의 모양은 명세에 없다. "응답에 기준 커밋 포함"뿐이라 목록 규칙(1.1)의 items로 올 수도 있다. */
function withListingDefaults(listing: Omit<FileListing, 'entries'> & { entries?: FileListing['entries'] | null; items?: FileListing['entries'] | null }): FileListing {
  return { ...listing, entries: listing.entries ?? listing.items ?? [] }
}

export const authApi = {
  login: (employeeNo: string, password: string) =>
    http<LoginResponse>('POST', '/auth/login', { body: { employeeNo, password }, skipRefresh: true }),
  verifyOtp: (tempToken: string, code: string) =>
    http<TokenResponse>('POST', '/auth/otp/verify', { body: { tempToken, code }, skipRefresh: true }),
  refresh: () => http<TokenResponse>('POST', '/auth/refresh', { skipRefresh: true }),
  logout: () => http<void>('POST', '/auth/logout', { skipRefresh: true }),
}

export const meApi = {
  get: () => http<Me>('GET', '/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    http<void>('PUT', '/me/password', { body: { currentPassword, newPassword } }),
  enrollOtp: (code?: string) => http<{ secret: string; enrolled: boolean }>('POST', '/me/otp', { body: { code } }),
  submitSigningKey: (publicKey: string) => http<SigningKey>('POST', '/me/signing-keys', { body: { publicKey } }),
  signingKeys: () => allPages<SigningKey>('/me/signing-keys'),
  webshellPublicKey: () => http<WebshellPublicKey>('GET', '/webshell/public-key').then(requireWebshellKey),
  notificationSettings: () => http<NotificationSettings>('GET', '/me/notification-settings'),
  updateNotificationSettings: (body: NotificationSettings) =>
    http<NotificationSettings>('PUT', '/me/notification-settings', { body }),
}

export const adminApi = {
  users: (query?: { departmentId?: string; role?: Role }) => allPages<User>('/admin/users', query),
  createUser: (body: { employeeNo: string; name: string; role: Role; departmentId: string | null; slackUserId?: string }) =>
    http<CreateUserResponse>('POST', '/admin/users', { body }),
  updateUser: (
    userId: string,
    body: Partial<Pick<User, 'role' | 'departmentId' | 'slackUserId' | 'active'>>,
  ) => http<User>('PATCH', `/admin/users/${userId}`, { body }),
  resetPassword: (userId: string) =>
    http<{ initialPassword: string }>('POST', `/admin/users/${userId}/reset-password`),
  createDepartment: (name: string) => http<Department>('POST', '/admin/departments', { body: { name } }),
  policy: () => http<Policy>('GET', '/admin/policy'),
  applyPreset: (preset: PolicyPreset) => http<Policy>('PUT', '/admin/policy/preset', { body: { preset } }),
  updateMatrix: (rows: ApprovalMatrixRow[]) =>
    http<Parameters<typeof toMatrixRows>[0]>('PUT', '/admin/approval-matrix', { body: { rows } }).then(toMatrixRows),
  signingKeys: () => allPages<SigningKey>('/admin/signing-keys'),
  registerKey: (keyId: string) => http<SigningKey>('POST', `/admin/signing-keys/${keyId}/register`),
  revokeKey: (keyId: string) => http<SigningKey>('DELETE', `/admin/signing-keys/${keyId}`),
  updateSlack: (body: SlackIntegration) => http<SlackIntegration>('PUT', '/admin/integrations/slack', { body }),
  killAll: (reason: string) => http<{ killedRequestIds: string[] }>('POST', '/admin/kill-all', { body: { reason } }),
  createProject: (body: {
    name: string
    departmentId: string
    repository: string
    ownerIds: string[]
    specBody: string
  }) => http<Project>('POST', '/admin/projects', { body }).then(withProjectDefaults),
}

export const orgApi = {
  departments: () => allPages<Department>('/departments'),
  approvalMatrix: () => http<Parameters<typeof toMatrixRows>[0]>('GET', '/approval-matrix').then(toMatrixRows),
}

export const projectsApi = {
  list: () => allPages<Project>('/projects').then((page) => withItems(page, withProjectDefaults)),
  get: (projectId: string) => http<Project>('GET', `/projects/${projectId}`).then(withProjectDefaults),
  spec: (projectId: string) => http<ProjectSpec>('GET', `/projects/${projectId}/spec`).then(withSpecDefaults),
  updateSpec: (projectId: string, body: string) =>
    http<ProjectSpec>('PUT', `/projects/${projectId}/spec`, { body: { body } }).then(withSpecDefaults),
  specVersions: (projectId: string) =>
    allPages<ProjectSpec>(`/projects/${projectId}/spec/versions`).then((page) => withItems(page, withSpecDefaults)),
  restoreSpec: (projectId: string, version: number) =>
    http<ProjectSpec>('POST', `/projects/${projectId}/spec/versions/${version}/restore`).then(withSpecDefaults),
  updateOwners: (projectId: string, ownerIds: string[]) =>
    http<Project>('PUT', `/projects/${projectId}/owners`, { body: { ownerIds } }).then(withProjectDefaults),
  createChangeRequest: (projectId: string, body: { content: string; reason: string }) =>
    http<SpecChangeRequest>('POST', `/projects/${projectId}/spec/change-requests`, { body }),
  changeRequests: (projectId: string, status?: ChangeRequestStatus) =>
    allPages<SpecChangeRequest>(`/projects/${projectId}/spec/change-requests`, { status }).then((page) =>
      withItems(page, withChangeRequestDefaults),
    ),
  acceptChangeRequest: (projectId: string, crId: string) =>
    http<SpecChangeRequest>('POST', `/projects/${projectId}/spec/change-requests/${crId}/accept`),
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
  confirm: (proposalId: string) => http<ForbiddenProposal>('POST', `/admin/forbidden-proposals/${proposalId}/confirm`),
  reject: (proposalId: string, reason: string) =>
    http<ForbiddenProposal>('POST', `/admin/forbidden-proposals/${proposalId}/reject`, { body: { reason } }),
  addRule: (body: ForbiddenInput & { departmentId: string }) =>
    http<ForbiddenRule>('POST', '/admin/forbidden-rules', { body }),
  release: (ruleId: string) => http<ForbiddenRule>('POST', `/admin/forbidden-rules/${ruleId}/release`),
}

export const requestsApi = {
  create: (body: CreateRequestBody) => http<AcceptedRequest>('POST', '/requests', { body }),
  list: (query?: { mine?: boolean; status?: RequestStatus; projectId?: string; cursor?: string; limit?: number }) =>
    http<Page<RequestSummary>>('GET', '/requests', { query }),
  /** 화면이 건수나 전체를 믿어야 할 때만 쓴다 (전사 일괄 중단 대상 등) */
  listAll: (query?: { mine?: boolean; status?: RequestStatus; projectId?: string }) => allPages<RequestSummary>('/requests', query),
  get: (requestId: string) => http<RawRequestDetail>('GET', `/requests/${requestId}`).then(withDetailDefaults),
  retryAnalysis: (requestId: string) => http<AcceptedRequest>('POST', `/requests/${requestId}/analysis/retry`),
  patchPlan: (requestId: string, body: PatchPlanBody) =>
    http<AcceptedRequest>('PATCH', `/requests/${requestId}/plan`, { body }),
  submit: (requestId: string) => http<SubmitResponse>('POST', `/requests/${requestId}/submit`),
  cancel: (requestId: string) => http<AcceptedRequest>('POST', `/requests/${requestId}/cancel`),
  kill: (requestId: string, reason: string) =>
    http<KillResponse>('POST', `/requests/${requestId}/kill`, { body: { reason } }),
  retryFailed: (requestId: string) =>
    http<SubmitResponse>('POST', `/requests/${requestId}/retry`).then((result) => withSubmitDefaults(requestId, result)),
  logs: (requestId: string, query?: { cursor?: string; limit?: number }) =>
    http<Page<LogLine>>('GET', `/requests/${requestId}/logs`, { query }),
  /** TODO(spec): 로그 스트림의 이벤트 이름과 연결 유지 메시지는 명세에 없다. seq가 있는 메시지만 로그로 본다. */
  streamLogs: (requestId: string, onLine: (line: LogLine) => void, signal: AbortSignal) =>
    streamMessages(
      `/requests/${requestId}/logs/stream`,
      ({ data }) => {
        const line = parseJson(data) as LogLine | null
        if (typeof line?.seq === 'number') onLine(line)
      },
      signal,
    ),
  progress: (requestId: string) => http<ProgressTree>('GET', `/requests/${requestId}/progress`).then(withTreeDefaults),
  /** lastVersion을 주면 Last-Event-ID로 보내 그 뒤부터 이어 받는다 (명세 4.9) */
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
    http<SubmitResponse>('POST', `/requests/${requestId}/rollback`, { body }).then((result) => withSubmitDefaults(requestId, result)),
}

export const approvalsApi = {
  pending: () => allPages<PendingApproval>('/approvals/pending').then((page) => withItems(page, withPendingDefaults)),
  context: (requestId: string) => http<ApprovalContext>('GET', `/requests/${requestId}/approval-context`),
  submit: (requestId: string, body: SubmitApprovalBody) =>
    http<SubmitApprovalResponse>('POST', `/requests/${requestId}/approvals`, { body }),
  reject: (requestId: string, body: RejectBody) =>
    http<AcceptedRequest>('POST', `/requests/${requestId}/rejections`, { body }),
}

export const documentsApi = {
  list: (projectId: string) => allPages<DocumentSummary>(`/projects/${projectId}/documents`),
  versions: (documentId: string) =>
    allPages<DocumentVersionSummary>(`/documents/${documentId}/versions`).then((page) => withItems(page, withVersionDefaults)),
  version: (documentId: string, version: number) =>
    http<DocumentVersion>('GET', `/documents/${documentId}/versions/${version}`).then(withVersionDefaults),
}

export const editorApi = {
  files: (projectId: string, query?: { path?: string; ref?: string }) =>
    http<Parameters<typeof withListingDefaults>[0]>('GET', `/projects/${projectId}/files`, { query }).then(withListingDefaults),
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
  list: (query: AuditLogQuery) => http<Page<AuditLog>>('GET', '/audit-logs', { query: { ...query } }),
  get: (logId: string) => http<AuditLog>('GET', `/audit-logs/${logId}`),
}

export const auditExportApi = {
  create: (body: CreateAuditExportBody) => http<AuditExportAccepted>('POST', '/audit-logs/exports', { body }),
  list: () => http<Page<AuditExport>>('GET', '/audit-logs/exports'),
  get: (exportId: string) => http<AuditExport>('GET', `/audit-logs/exports/${exportId}`),
  download: (exportId: string, fileName: string) => downloadFile(`/audit-logs/exports/${exportId}/file`, fileName),
}
