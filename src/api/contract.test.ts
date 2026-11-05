import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { API_BASE_URL, setTransport } from './client'
import {
  adminApi,
  approvalsApi,
  auditApi,
  auditExportApi,
  authApi,
  dashboardApi,
  documentsApi,
  editorApi,
  forbiddenApi,
  meApi,
  orgApi,
  projectsApi,
  requestsApi,
} from './endpoints'
import { followLogs } from './logStream'
import { MISSING_ON_SERVER } from './missingOnServer'
import type { AdminProof, ApprovalEnvelope, ApprovalMatrixRule, PatchPlanBody } from './types'

/**
 * API 명세 3.1~3.9의 표를 그대로 옮겼다. 메서드, 경로, 쿼리, 본문을 클라이언트가 실제로 보내는 값과 비교한다.
 * 경로를 바꾸면 여기서 실패해야 한다. 코드를 따라 표를 고치지 말고 명세를 먼저 확인한다.
 * spec의 {이름}은 아래 IDS의 값으로 바뀐다.
 */
const IDS: Record<string, string> = {
  userId: 'user-1',
  keyId: 'key-1',
  projectId: 'project-1',
  version: '3',
  crId: 'cr-1',
  deptId: 'dept-1',
  proposalId: 'proposal-1',
  ruleId: 'rule-1',
  requestId: 'request-1',
  taskId: 'task-1',
  documentId: 'document-1',
  logId: 'log-1',
  exportId: 'export-1',
}

/** 쪽을 끝까지 따라가는 목록은 명세 1.1의 최대치로 읽는다. */
const ALL_PAGES = { limit: '100' }

const ENVELOPE: ApprovalEnvelope = { alg: 'HPKE-X25519-AES256GCM', encapsulatedKey: 'ek', ciphertext: 'ct' }
const MATRIX: ApprovalMatrixRule[] = [{ taskType: 'DOC', risk: 'LOW', requiredApprovers: [{ rule: 'ANYONE', count: 1 }] }]
const PROOF: AdminProof = { keyId: 'key-2', signature: 'c2ln' }
const PLAN_PATCH: PatchPlanBody = {
  basePlanId: 'plan-1',
  changes: [
    { op: 'UPDATE', taskId: 'task-1', instruction: '메시지를 바꿔줘' },
    { op: 'DELETE', taskId: 'task-2' },
  ],
}
/** 명세 4.10의 예시 그대로 */
const EXPORT_FILTERS = {
  departmentId: 'd',
  action: 'APPROVAL_SUBMITTED',
  network: 'EXTERNAL' as const,
  from: '2026-10-01T00:00:00Z',
  to: '2026-11-01T00:00:00Z',
}
const FORBIDDEN = { taskType: 'DEPLOY' as const, target: 'production', reason: '사유' }
const ROLLBACK = { taskIds: ['task-1'], targetVersion: 3, reason: '잘못 적용' }
const NEVER = new AbortController().signal

interface Row {
  spec: string
  call: () => Promise<unknown>
  query?: Record<string, string>
  body?: unknown
  /** 요청 헤더 중 확인할 값 */
  headers?: Record<string, string>
  /** 기본 응답({ items: [] })으로는 읽을 수 없는 API의 응답 */
  reply?: unknown
  stream?: boolean
}

const WEBSHELL_KEY = {
  encryption: { algorithm: 'X25519', publicKey: 'enc', fingerprint: 'sha256:1' },
  signing: { algorithm: 'Ed25519', publicKey: 'sig', fingerprint: 'sha256:2' },
}
const TREE = { requestId: 'request-1', version: 1, updatedAt: '2026-11-04T03:15:20Z', root: { id: 'request:1', type: 'REQUEST', label: '요청', status: 'RUNNING', children: [] } }

const ROWS: Row[] = [
  // 3.1 인증·내 정보·승인 키
  { spec: 'POST /auth/login', call: () => authApi.login('E1', 'pw'), body: { employeeNumber: 'E1', password: 'pw' } },
  { spec: 'POST /auth/otp/verify', call: () => authApi.verifyOtp('temp', '123456'), body: { temporaryToken: 'temp', otpCode: '123456' } },
  { spec: 'POST /auth/refresh', call: () => authApi.refresh() },
  { spec: 'POST /auth/logout', call: () => authApi.logout() },
  { spec: 'GET /me', call: () => meApi.get() },
  { spec: 'PUT /me/password', call: () => meApi.changePassword('old', 'new'), body: { currentPassword: 'old', newPassword: 'new' } },
  { spec: 'POST /me/otp', call: () => meApi.confirmOtp('123456'), body: { otpCode: '123456' }, reply: { verified: true } },
  { spec: 'POST /me/signing-keys', call: () => meApi.submitSigningKey('pub'), body: { algorithm: 'Ed25519', publicKey: 'pub' } },
  { spec: 'GET /me/signing-keys', call: () => meApi.signingKeys(), query: ALL_PAGES },
  { spec: 'GET /webshell/public-key', call: () => meApi.webshellPublicKey(), reply: WEBSHELL_KEY },
  { spec: 'GET /me/notification-settings', call: () => meApi.notificationSettings() },
  {
    spec: 'PUT /me/notification-settings',
    call: () => meApi.updateNotificationSettings({ slackUserId: 'U1', approvalRequests: true, requestResults: false }),
    body: { slackUserId: 'U1', approvalRequests: true, requestResults: false },
  },

  // 3.2 관리자: 계정·조직·정책·키
  {
    spec: 'POST /admin/users',
    call: () => adminApi.createUser({ employeeNumber: 'E2', name: '이름', role: 'EMPLOYEE', departmentId: 'dept-1' }),
    body: { employeeNumber: 'E2', name: '이름', role: 'EMPLOYEE', departmentId: 'dept-1' },
  },
  {
    spec: 'GET /admin/users',
    call: () => adminApi.users({ departmentId: 'dept-1', role: 'ADMIN' }),
    query: { departmentId: 'dept-1', role: 'ADMIN', ...ALL_PAGES },
  },
  { spec: 'PATCH /admin/users/{userId}', call: () => adminApi.updateUser('user-1', { active: false }), body: { active: false } },
  { spec: 'POST /admin/users/{userId}/reset-password', call: () => adminApi.resetPassword('user-1') },
  { spec: 'GET /departments', call: () => orgApi.departments(), query: ALL_PAGES },
  { spec: 'POST /admin/departments', call: () => adminApi.createDepartment('백엔드'), body: { name: '백엔드' } },
  { spec: 'GET /admin/policy', call: () => adminApi.policy() },
  { spec: 'PUT /admin/policy/preset', call: () => adminApi.applyPreset('LARGE', PROOF), body: { preset: 'LARGE', adminProof: PROOF } },
  { spec: 'GET /approval-matrix', call: () => orgApi.approvalMatrix() },
  { spec: 'PUT /admin/approval-matrix', call: () => adminApi.updateMatrix(MATRIX, PROOF), body: { rules: MATRIX, adminProof: PROOF } },
  { spec: 'GET /admin/signing-keys', call: () => adminApi.signingKeys(), query: ALL_PAGES },
  {
    spec: 'POST /admin/signing-keys/{keyId}/register',
    call: () => adminApi.registerKey('key-1', { keyId: 'key-2', signature: 'c2ln' }),
    body: { adminProof: { keyId: 'key-2', signature: 'c2ln' } },
  },
  { spec: 'DELETE /admin/signing-keys/{keyId}', call: () => adminApi.revokeKey('key-1') },
  {
    spec: 'PUT /admin/integrations/slack',
    call: () => adminApi.updateSlack({ workspace: 'w', defaultChannel: '#c' }),
    body: { workspace: 'w', defaultChannel: '#c' },
  },
  { spec: 'POST /admin/kill-all', call: () => adminApi.killAll('사유'), body: { reason: '사유' } },

  // 3.3 프로젝트·기획서
  { spec: 'GET /projects', call: () => projectsApi.list(), query: ALL_PAGES },
  {
    spec: 'POST /admin/projects',
    call: () => adminApi.createProject({ name: 'p', departmentId: 'dept-1', repository: 'r', ownerIds: ['a', 'b'], initialSpec: { body: 's' } }),
    body: { name: 'p', departmentId: 'dept-1', repository: 'r', ownerIds: ['a', 'b'], initialSpec: { body: 's' } },
  },
  { spec: 'GET /projects/{projectId}', call: () => projectsApi.get('project-1') },
  { spec: 'GET /projects/{projectId}/spec', call: () => projectsApi.spec('project-1') },
  { spec: 'PUT /projects/{projectId}/spec', call: () => projectsApi.updateSpec('project-1', '본문'), body: { body: '본문' } },
  { spec: 'GET /projects/{projectId}/spec/versions', call: () => projectsApi.specVersions('project-1'), query: ALL_PAGES },
  { spec: 'POST /projects/{projectId}/spec/versions/{version}/restore', call: () => projectsApi.restoreSpec('project-1', 3) },
  { spec: 'PUT /projects/{projectId}/owners', call: () => projectsApi.updateOwners('project-1', ['a', 'b']), body: { ownerIds: ['a', 'b'] } },
  {
    spec: 'POST /projects/{projectId}/spec/change-requests',
    call: () => projectsApi.createChangeRequest('project-1', { content: '내용', reason: '사유' }),
    body: { content: '내용', reason: '사유' },
  },
  {
    spec: 'GET /projects/{projectId}/spec/change-requests',
    call: () => projectsApi.changeRequests('project-1', 'OPEN'),
    query: { status: 'OPEN', ...ALL_PAGES },
  },
  { spec: 'POST /projects/{projectId}/spec/change-requests/{crId}/accept', call: () => projectsApi.acceptChangeRequest('project-1', 'cr-1') },
  {
    spec: 'POST /projects/{projectId}/spec/change-requests/{crId}/reject',
    call: () => projectsApi.rejectChangeRequest('project-1', 'cr-1', '사유'),
    body: { reason: '사유' },
  },

  // 3.4 금지 작업
  { spec: 'GET /departments/{deptId}/forbidden-rules', call: () => forbiddenApi.rules('dept-1'), query: ALL_PAGES },
  { spec: 'POST /departments/{deptId}/forbidden-proposals', call: () => forbiddenApi.propose('dept-1', FORBIDDEN), body: FORBIDDEN },
  { spec: 'GET /admin/forbidden-proposals', call: () => forbiddenApi.proposals('OPEN'), query: { status: 'OPEN', ...ALL_PAGES } },
  {
    spec: 'POST /admin/forbidden-proposals/{proposalId}/confirm',
    call: () => forbiddenApi.confirm('proposal-1', PROOF),
    body: { adminProof: PROOF },
  },
  { spec: 'POST /admin/forbidden-proposals/{proposalId}/reject', call: () => forbiddenApi.reject('proposal-1', '사유'), body: { reason: '사유' } },
  {
    spec: 'POST /admin/forbidden-rules',
    call: () => forbiddenApi.addRule({ ...FORBIDDEN, departmentId: 'dept-1', adminProof: PROOF }),
    body: { ...FORBIDDEN, departmentId: 'dept-1', adminProof: PROOF },
  },
  {
    spec: 'POST /admin/forbidden-rules/{ruleId}/release',
    call: () => forbiddenApi.release('rule-1', { reason: '사유', adminProof: PROOF }),
    body: { reason: '사유', adminProof: PROOF },
  },

  // 3.5 작업 요청·Plan·실행 (4.1, 4.2, 4.3, 4.6, 4.9)
  { spec: 'POST /requests', call: () => requestsApi.create({ projectId: 'project-1', prompt: '해줘' }), body: { projectId: 'project-1', prompt: '해줘' } },
  {
    spec: 'GET /requests',
    call: () => requestsApi.list({ mine: true, status: 'RUNNING', projectId: 'project-1', cursor: 'c1', limit: 50 }),
    query: { mine: 'true', status: 'RUNNING', projectId: 'project-1', cursor: 'c1', limit: '50' },
  },
  { spec: 'GET /requests/{requestId}', call: () => requestsApi.get('request-1') },
  { spec: 'POST /requests/{requestId}/analysis/retry', call: () => requestsApi.retryAnalysis('request-1') },
  { spec: 'PATCH /requests/{requestId}/plan', call: () => requestsApi.patchPlan('request-1', PLAN_PATCH), body: PLAN_PATCH },
  { spec: 'POST /requests/{requestId}/submit', call: () => requestsApi.submit('request-1') },
  { spec: 'POST /requests/{requestId}/cancel', call: () => requestsApi.cancel('request-1') },
  { spec: 'POST /requests/{requestId}/kill', call: () => requestsApi.kill('request-1', '잘못된 브랜치'), body: { reason: '잘못된 브랜치' } },
  { spec: 'POST /requests/{requestId}/retry', call: () => requestsApi.retryFailed('request-1') },
  {
    spec: 'GET /requests/{requestId}/logs',
    call: () => requestsApi.logs('request-1', { cursor: 'c1', limit: 100 }),
    query: { cursor: 'c1', limit: '100' },
  },
  {
    spec: 'GET /requests/{requestId}/logs/stream',
    call: () => requestsApi.streamLogs('request-1', () => {}, NEVER),
    headers: { accept: 'text/event-stream' },
    stream: true,
  },
  { spec: 'GET /requests/{requestId}/progress', call: () => requestsApi.progress('request-1'), reply: TREE },
  {
    spec: 'GET /requests/{requestId}/progress/stream',
    call: () => requestsApi.streamProgress('request-1', () => {}, NEVER, 42),
    headers: { accept: 'text/event-stream', 'last-event-id': '42' },
    stream: true,
  },

  // 3.6 승인 (4.4, 4.5)
  { spec: 'GET /approvals/pending', call: () => approvalsApi.pending(), query: ALL_PAGES },
  { spec: 'GET /requests/{requestId}/approval-context', call: () => approvalsApi.context('request-1') },
  {
    spec: 'POST /requests/{requestId}/approvals',
    call: () => approvalsApi.submit('request-1', { planId: 'plan-1', planHash: 'sha256:1', taskIds: ['task-1'], keyId: 'key-1', envelope: ENVELOPE }),
    body: { planId: 'plan-1', planHash: 'sha256:1', taskIds: ['task-1'], keyId: 'key-1', envelope: ENVELOPE },
  },
  {
    spec: 'POST /requests/{requestId}/rejections',
    call: () => approvalsApi.reject('request-1', { planId: 'plan-1', taskIds: ['task-1'], reason: '사유' }),
    body: { planId: 'plan-1', taskIds: ['task-1'], reason: '사유' },
  },

  // 3.7 문서·문서 롤백
  { spec: 'GET /requests/{requestId}/tasks/{taskId}/document', call: () => requestsApi.taskDocument('request-1', 'task-1') },
  { spec: 'GET /projects/{projectId}/documents', call: () => documentsApi.list('project-1'), query: ALL_PAGES },
  { spec: 'GET /documents/{documentId}/versions', call: () => documentsApi.versions('document-1'), query: ALL_PAGES },
  { spec: 'GET /documents/{documentId}/versions/{version}', call: () => documentsApi.version('document-1', 3) },
  {
    spec: 'POST /requests/{requestId}/rollback',
    call: () => requestsApi.rollback('request-1', ROLLBACK),
    body: ROLLBACK,
  },

  // 3.8 웹 코드 에디터 (4.7)
  { spec: 'GET /projects/{projectId}/files', call: () => editorApi.files('project-1', { path: 'src', ref: 'main' }), query: { path: 'src', ref: 'main' } },
  {
    spec: 'GET /projects/{projectId}/files/content',
    call: () => editorApi.content('project-1', { path: 'src/a.ts', ref: 'main' }),
    query: { path: 'src/a.ts', ref: 'main' },
  },
  {
    spec: 'POST /projects/{projectId}/editor/changes',
    call: () => editorApi.save('project-1', { baseCommit: 'abc', description: '수정', files: [{ path: 'a.ts', patch: 'p' }] }),
    body: { baseCommit: 'abc', description: '수정', files: [{ path: 'a.ts', patch: 'p' }] },
  },

  // 3.9 대시보드·감사 로그 (4.8, 4.10)
  { spec: 'GET /dashboard', call: () => dashboardApi.get('DEPARTMENT', 'dept-1'), query: { scope: 'DEPARTMENT', departmentId: 'dept-1' } },
  {
    spec: 'GET /audit-logs',
    call: () =>
      auditApi.list({
        actorId: 'a',
        departmentId: 'd',
        projectId: 'p',
        requestId: 'r',
        action: 'LOGIN',
        network: 'EXTERNAL',
        from: '2026-10-01T00:00:00Z',
        to: '2026-11-01T00:00:00Z',
        cursor: 'c1',
        limit: 50,
      }),
    query: {
      actorId: 'a',
      departmentId: 'd',
      projectId: 'p',
      requestId: 'r',
      action: 'LOGIN',
      network: 'EXTERNAL',
      from: '2026-10-01T00:00:00Z',
      to: '2026-11-01T00:00:00Z',
      cursor: 'c1',
      limit: '50',
    },
  },
  { spec: 'GET /audit-logs/{logId}', call: () => auditApi.get('log-1') },
  {
    spec: 'POST /audit-logs/exports',
    call: () => auditExportApi.create({ format: 'XLSX', filters: EXPORT_FILTERS }),
    body: { format: 'XLSX', filters: EXPORT_FILTERS },
  },
  { spec: 'GET /audit-logs/exports', call: () => auditExportApi.list() },
  { spec: 'GET /audit-logs/exports/{exportId}', call: () => auditExportApi.get('export-1') },
  { spec: 'GET /audit-logs/exports/{exportId}/file', call: () => auditExportApi.download('export-1', 'a.xlsx') },
]

/** 표에는 있지만 브라우저 코드가 부르지 않는 행. Slack이 서버로 직접 돌아오는 주소다. */
const NOT_CALLED_BY_CLIENT = ['GET /integrations/slack/oauth/callback']

interface Sent {
  method: string
  url: URL
  headers: Headers
  body: unknown
}

let sent: Sent[]

function useReply(reply: (url: URL) => { body: unknown; contentType?: string }) {
  setTransport(async (input, init) => {
    const url = new URL(input, 'http://client.test')
    sent.push({
      method: init.method ?? 'GET',
      url,
      headers: new Headers(init.headers),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    })
    const { body, contentType = 'application/json' } = reply(url)
    return new Response(contentType === 'application/json' ? JSON.stringify(body) : (body as string), {
      status: 200,
      headers: { 'Content-Type': contentType },
    })
  })
}

const pathOf = (spec: string) => spec.split(' ')[1].replace(/\{(\w+)\}/g, (_, name: string) => IDS[name])

beforeEach(() => {
  sent = []
  // 파일 내려받기가 쓰는 브라우저 객체만 흉내 낸다. 실제 네트워크로는 나가지 않는다.
  vi.stubGlobal('document', { createElement: () => ({ click: () => {} }) })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('API 명세 3장 표', () => {
  it.each(ROWS)('$spec', async ({ spec, call, query = {}, body, headers = {}, reply, stream }) => {
    useReply(() =>
      stream
        ? { body: '', contentType: 'text/event-stream' }
        : { body: reply ?? { items: [], nextCursor: null } },
    )
    await call()

    expect(sent).toHaveLength(1)
    const [request] = sent
    const [method] = spec.split(' ')
    expect(request.method).toBe(method)
    expect(request.url.pathname).toBe(new URL(`${API_BASE_URL}${pathOf(spec)}`, 'http://client.test').pathname)
    expect(Object.fromEntries(request.url.searchParams)).toEqual(query)
    expect(request.body).toEqual(body)
    for (const [name, value] of Object.entries(headers)) expect(request.headers.get(name)).toBe(value)
  })

  it('서버에 없는 API 목록은 정해 둔 4건과 같고 모두 표에 있다', () => {
    const specs = ROWS.map((row) => row.spec)
    expect(MISSING_ON_SERVER.map(({ operation }) => operation)).toEqual([
      'GET /me/notification-settings',
      'PUT /me/notification-settings',
      'PUT /admin/integrations/slack',
      'PUT /projects/{projectId}/owners',
    ])
    for (const { operation } of MISSING_ON_SERVER) expect(specs).toContain(operation)
  })

  it('기획서 복원 사유는 있을 때만 본문에 싣는다', async () => {
    useReply(() => ({ body: {} }))
    await projectsApi.restoreSpec('project-1', 3, '  잘못 고침 ')
    await projectsApi.restoreSpec('project-1', 3, '   ')
    expect(sent.map((request) => request.body)).toEqual([{ reason: '잘못 고침' }, undefined])
  })

  it('등록된 키 폐기는 본문에 adminProof를 싣는다', async () => {
    useReply(() => ({ body: {} }))
    await adminApi.revokeKey('key-1', PROOF)
    expect(sent[0].method).toBe('DELETE')
    expect(sent[0].body).toEqual({ adminProof: PROOF })
  })

  it('표의 행은 겹치지 않는다', () => {
    const specs = [...ROWS.map((row) => row.spec), ...NOT_CALLED_BY_CLIENT]
    expect(new Set(specs).size).toBe(specs.length)
  })

  it('화면이 쓰는 로그 스트림도 같은 경로로 가고, 서버가 받지 않는 Last-Event-ID는 보내지 않는다', async () => {
    useReply((url) => (url.pathname.endsWith('/stream') ? { body: '', contentType: 'text/event-stream' } : { body: { items: [], nextCursor: null } }))
    const controller = new AbortController()
    let opened: () => void = () => {}
    const connected = new Promise<void>((resolve) => {
      opened = resolve
    })
    const done = followLogs({
      requestId: 'request-1',
      live: true,
      signal: controller.signal,
      onLine: () => {},
      onConnection: (connection) => {
        if (connection) opened()
      },
    })
    await connected
    controller.abort()
    await done
    const stream = sent.find((request) => request.url.pathname.endsWith('/logs/stream'))
    expect(stream?.url.pathname).toBe(new URL(`${API_BASE_URL}/requests/request-1/logs/stream`, 'http://client.test').pathname)
    expect(stream?.headers.get('last-event-id')).toBeNull()
  })
})

describe('명세 1.1 페이지', () => {
  it('화면이 전부를 믿는 목록은 nextCursor를 끝까지 따라간다', async () => {
    useReply((url) => {
      const cursor = url.searchParams.get('cursor')
      if (cursor === null) return { body: { items: [{ id: 'a' }], nextCursor: 'c1' } }
      if (cursor === 'c1') return { body: { items: [{ id: 'b' }], nextCursor: 'c2' } }
      return { body: { items: [{ id: 'c' }], nextCursor: null } }
    })
    const { items, nextCursor } = await orgApi.departments()
    expect(items.map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(nextCursor).toBeNull()
    expect(sent.map((request) => request.url.searchParams.get('cursor'))).toEqual([null, 'c1', 'c2'])
    expect(sent.every((request) => request.url.searchParams.get('limit') === '100')).toBe(true)
  })

  it('서버가 같은 커서를 되풀이해도 멈춘다', async () => {
    useReply(() => ({ body: { items: [{ id: 'a' }], nextCursor: 'same' } }))
    await orgApi.departments()
    expect(sent).toHaveLength(2)
  })
})
