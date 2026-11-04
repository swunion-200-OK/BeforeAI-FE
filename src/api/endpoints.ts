import { http } from './client'
import { streamEvents } from './sse'
import type {
  AcceptedRequest,
  ApprovalContext,
  ApprovalMatrixRow,
  AuditLog,
  AuditLogQuery,
  ChangeRequestStatus,
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
  Project,
  ProjectSpec,
  RejectBody,
  RequestDetail,
  RequestStatus,
  RequestSummary,
  Role,
  RollbackBody,
  SigningKey,
  SlackIntegration,
  SpecChangeRequest,
  SubmitApprovalBody,
  SubmitApprovalResponse,
  SubmitResponse,
  TaskDocument,
  TaskType,
  TokenResponse,
  User,
} from './types'

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
  signingKeys: () => http<Page<SigningKey>>('GET', '/me/signing-keys'),
  executorPublicKey: () => http<{ publicKey: string }>('GET', '/executor/public-key'),
  notificationSettings: () => http<NotificationSettings>('GET', '/me/notification-settings'),
  updateNotificationSettings: (body: NotificationSettings) =>
    http<NotificationSettings>('PUT', '/me/notification-settings', { body }),
}

export const adminApi = {
  users: (query?: { departmentId?: string; role?: Role }) => http<Page<User>>('GET', '/admin/users', { query }),
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
    http<ApprovalMatrixRow[]>('PUT', '/admin/approval-matrix', { body: { rows } }),
  signingKeys: () => http<Page<SigningKey>>('GET', '/admin/signing-keys'),
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
  }) => http<Project>('POST', '/admin/projects', { body }),
}

export const orgApi = {
  departments: () => http<Page<Department>>('GET', '/departments'),
  approvalMatrix: () => http<ApprovalMatrixRow[]>('GET', '/approval-matrix'),
}

export const projectsApi = {
  list: () => http<Page<Project>>('GET', '/projects'),
  get: (projectId: string) => http<Project>('GET', `/projects/${projectId}`),
  spec: (projectId: string) => http<ProjectSpec>('GET', `/projects/${projectId}/spec`),
  updateSpec: (projectId: string, body: string) =>
    http<ProjectSpec>('PUT', `/projects/${projectId}/spec`, { body: { body } }),
  specVersions: (projectId: string) => http<Page<ProjectSpec>>('GET', `/projects/${projectId}/spec/versions`),
  restoreSpec: (projectId: string, version: number) =>
    http<ProjectSpec>('POST', `/projects/${projectId}/spec/versions/${version}/restore`),
  updateOwners: (projectId: string, ownerIds: string[]) =>
    http<Project>('PUT', `/projects/${projectId}/owners`, { body: { ownerIds } }),
  createChangeRequest: (projectId: string, body: { content: string; reason: string }) =>
    http<SpecChangeRequest>('POST', `/projects/${projectId}/spec/change-requests`, { body }),
  changeRequests: (projectId: string, status?: ChangeRequestStatus) =>
    http<Page<SpecChangeRequest>>('GET', `/projects/${projectId}/spec/change-requests`, { query: { status } }),
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
  rules: (deptId: string) => http<Page<ForbiddenRule>>('GET', `/departments/${deptId}/forbidden-rules`),
  propose: (deptId: string, body: ForbiddenInput) =>
    http<ForbiddenProposal>('POST', `/departments/${deptId}/forbidden-proposals`, { body }),
  proposals: (status?: ForbiddenProposalStatus) =>
    http<Page<ForbiddenProposal>>('GET', '/admin/forbidden-proposals', { query: { status } }),
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
  get: (requestId: string) => http<RequestDetail>('GET', `/requests/${requestId}`),
  retryAnalysis: (requestId: string) => http<AcceptedRequest>('POST', `/requests/${requestId}/analysis/retry`),
  patchPlan: (requestId: string, body: PatchPlanBody) =>
    http<AcceptedRequest>('PATCH', `/requests/${requestId}/plan`, { body }),
  submit: (requestId: string) => http<SubmitResponse>('POST', `/requests/${requestId}/submit`),
  cancel: (requestId: string) => http<AcceptedRequest>('POST', `/requests/${requestId}/cancel`),
  kill: (requestId: string, reason: string) =>
    http<KillResponse>('POST', `/requests/${requestId}/kill`, { body: { reason } }),
  retryFailed: (requestId: string) => http<SubmitResponse>('POST', `/requests/${requestId}/retry`),
  logs: (requestId: string, query?: { cursor?: string; limit?: number }) =>
    http<Page<LogLine>>('GET', `/requests/${requestId}/logs`, { query }),
  streamLogs: (requestId: string, onLine: (line: LogLine) => void, signal: AbortSignal) =>
    streamEvents<LogLine>(`/requests/${requestId}/logs/stream`, onLine, signal),
  taskDocument: (requestId: string, taskId: string) =>
    http<TaskDocument>('GET', `/requests/${requestId}/tasks/${taskId}/document`),
  rollback: (requestId: string, body: RollbackBody) =>
    http<SubmitResponse>('POST', `/requests/${requestId}/rollback`, { body }),
}

export const approvalsApi = {
  pending: () => http<Page<PendingApproval>>('GET', '/approvals/pending'),
  context: (requestId: string) => http<ApprovalContext>('GET', `/requests/${requestId}/approval-context`),
  submit: (requestId: string, body: SubmitApprovalBody) =>
    http<SubmitApprovalResponse>('POST', `/requests/${requestId}/approvals`, { body }),
  reject: (requestId: string, body: RejectBody) =>
    http<AcceptedRequest>('POST', `/requests/${requestId}/rejections`, { body }),
}

export const documentsApi = {
  list: (projectId: string) => http<Page<DocumentSummary>>('GET', `/projects/${projectId}/documents`),
  versions: (documentId: string) => http<Page<DocumentVersionSummary>>('GET', `/documents/${documentId}/versions`),
  version: (documentId: string, version: number) =>
    http<DocumentVersion>('GET', `/documents/${documentId}/versions/${version}`),
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
  get: (scope: DashboardScope, departmentId?: string) => http<Dashboard>('GET', '/dashboard', { query: { scope, departmentId } }),
}

export const auditApi = {
  list: (query: AuditLogQuery) => http<Page<AuditLog>>('GET', '/audit-logs', { query: { ...query } }),
  get: (logId: string) => http<AuditLog>('GET', `/audit-logs/${logId}`),
}
