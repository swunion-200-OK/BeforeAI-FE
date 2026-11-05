/**
 * 시연 데이터. 상태 배지를 전부 보여 줄 수 있게 요청을 상태별로 넣어 둔다.
 * 승인 서명은 실제 Ed25519로 만들기 때문에 r-main은 김담당이 서명하면 그대로 실행까지 간다.
 */
import { ed25519 } from '@noble/curves/ed25519.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { cryptoService } from '../../crypto/cryptoService'
import { deviceStore } from '../../crypto/deviceStore'
import { bytesToBase64 } from '../../crypto/encoding'
import { hashService, toHashTarget } from '../../crypto/hashService'
import { signingService } from '../../crypto/signingService'
import { makeUnifiedDiff } from '../../lib/diff'
import { explainTask } from '../../lib/explain'
import type {
  AuditAction,
  AuditLog,
  FailedCheck,
  LogLine,
  Network,
  RequestSource,
  RequestStatus,
  Risk,
  Role,
  Task,
  TaskContent,
  TaskStatus,
  TaskType,
} from '../types'
import { defaultRisk, makePlan } from './analysis'
import {
  AUTH_BASE_COMMIT,
  AUTH_FILES,
  AUTH_REPOSITORY,
  AUTH_SPEC_V1,
  AUTH_SPEC_V2,
  DEFAULT_MATRIX,
  DEPLOY_FILES,
  DEPLOY_SPEC,
} from './fixtures'
import { buildRequiredApprovers } from './policy'
import { SCHEMA_VERSION, SYSTEM_ACTOR, db, ipFor, setDb, type MockDb, type StoredRequest, type StoredUser } from './store'
import { WEBSHELL_PUBLIC_KEY, signLogLine, signedExecution } from './webshell'

const DEMO_PASSWORD = 'demo1234!'
const encoder = new TextEncoder()

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

interface SeedUser {
  id: string
  employeeNo: string
  name: string
  role: Role
  departmentId: string | null
  key?: { keyId: string; status: 'REGISTERED' | 'PENDING' }
  mustChangePassword?: boolean
}

const SEED_USERS: SeedUser[] = [
  { id: 'u-admin', employeeNo: 'E0001', name: '박CTO', role: 'ADMIN', departmentId: null, key: { keyId: 'k-admin-a', status: 'REGISTERED' } },
  { id: 'u-mgr-be', employeeNo: 'E1001', name: '최팀장', role: 'DEPT_MANAGER', departmentId: 'd-backend', key: { keyId: 'k-mgr-be-a', status: 'REGISTERED' } },
  { id: 'u-mgr-in', employeeNo: 'E2001', name: '정팀장', role: 'DEPT_MANAGER', departmentId: 'd-infra', key: { keyId: 'k-mgr-in-a', status: 'REGISTERED' } },
  { id: 'u-01', employeeNo: 'E1101', name: '홍길동', role: 'EMPLOYEE', departmentId: 'd-backend', key: { keyId: 'k-01-a', status: 'REGISTERED' } },
  { id: 'u-07', employeeNo: 'E1107', name: '김담당', role: 'EMPLOYEE', departmentId: 'd-backend', key: { keyId: 'k-07-a', status: 'REGISTERED' } },
  { id: 'u-09', employeeNo: 'E1109', name: '이담당', role: 'EMPLOYEE', departmentId: 'd-backend', key: { keyId: 'k-09-a', status: 'PENDING' } },
  { id: 'u-21', employeeNo: 'E2101', name: '오인프라', role: 'EMPLOYEE', departmentId: 'd-infra' },
  { id: 'u-31', employeeNo: 'E1131', name: '강신입', role: 'EMPLOYEE', departmentId: 'd-backend', mustChangePassword: true },
]

function seedKeyPair(userId: string) {
  const secret = sha256(encoder.encode(`beforeai-mock-device:${userId}`))
  return { secret: bytesToBase64(secret), publicKey: bytesToBase64(ed25519.getPublicKey(secret)) }
}

function emptyDb(): MockDb {
  return {
    schema: SCHEMA_VERSION,
    network: 'INTERNAL',
    session: null,
    seq: 100,
    users: [],
    departments: [
      { id: 'd-backend', name: '백엔드팀' },
      { id: 'd-infra', name: '인프라팀' },
    ],
    projects: [],
    specs: {},
    changeRequests: [],
    policy: { preset: 'SMALL', slackNotifications: 'OPTIONAL', auditRetention: '90일', slackIntegration: null },
    matrix: DEFAULT_MATRIX.map((row) => ({ ...row })),
    signingKeys: [],
    forbiddenRules: [],
    proposals: [],
    requests: [],
    logs: {},
    documents: [],
    docVersions: [],
    files: { 'prj-auth': { ...AUTH_FILES }, 'prj-deploy': { ...DEPLOY_FILES } },
    auditLogs: [],
    slackOutbox: [],
    notificationSettings: {},
    webshell: {
      usedNonces: [],
      policy: {
        keys: [],
        forbiddenRules: [],
        preset: 'SMALL',
        matrix: DEFAULT_MATRIX.map((row) => ({ ...row })),
      },
    },
  }
}

function seedPeople() {
  const database = db()
  for (const seed of SEED_USERS) {
    const user: StoredUser = {
      id: seed.id,
      employeeNo: seed.employeeNo,
      name: seed.name,
      role: seed.role,
      departmentId: seed.departmentId,
      slackUserId: `U${seed.employeeNo}`,
      active: true,
      mustChangePassword: seed.mustChangePassword ?? false,
      password: DEMO_PASSWORD,
      otpEnrolled: seed.role !== 'EMPLOYEE' || seed.id === 'u-07',
    }
    database.users.push(user)
    database.notificationSettings[user.id] = {
      slackUserId: user.slackUserId,
      approvalRequests: true,
      requestResults: true,
    }
    if (!seed.key) continue
    const pair = seedKeyPair(seed.id)
    deviceStore.update(seed.id, {
      keyId: seed.key.keyId,
      secretKey: pair.secret,
      publicKey: pair.publicKey,
      pinnedWebshellKey: WEBSHELL_PUBLIC_KEY,
    })
    database.signingKeys.push({
      keyId: seed.key.keyId,
      userId: seed.id,
      userName: seed.name,
      publicKey: pair.publicKey,
      status: seed.key.status,
      createdAt: minutesAgo(60 * 24 * 7),
      registeredAt: seed.key.status === 'REGISTERED' ? minutesAgo(60 * 24 * 6) : null,
    })
    if (seed.key.status === 'REGISTERED') {
      database.webshell.policy.keys.push({ keyId: seed.key.keyId, userId: seed.id, publicKey: pair.publicKey })
    }
  }
}

function ref(userId: string) {
  const user = db().users.find((u) => u.id === userId) as StoredUser
  return { id: user.id, name: user.name, departmentId: user.departmentId }
}

function seedProjects() {
  const database = db()
  database.projects.push(
    {
      id: 'prj-auth',
      name: 'auth-service',
      departmentId: 'd-backend',
      repository: AUTH_REPOSITORY,
      baseCommit: AUTH_BASE_COMMIT,
      owners: [ref('u-07'), ref('u-09')],
    },
    {
      id: 'prj-deploy',
      name: 'deploy-pipeline',
      departmentId: 'd-infra',
      repository: 'git@internal:deploy-pipeline.git',
      baseCommit: 'c41d7aa',
      owners: [ref('u-mgr-in'), ref('u-21')],
    },
  )
  const by = (id: string) => ({ id, name: ref(id).name })
  database.specs['prj-auth'] = [
    { projectId: 'prj-auth', version: 1, body: AUTH_SPEC_V1, updatedAt: minutesAgo(60 * 24 * 30), updatedBy: by('u-admin') },
    { projectId: 'prj-auth', version: 2, body: AUTH_SPEC_V2, updatedAt: minutesAgo(60 * 24 * 3), updatedBy: by('u-mgr-be') },
  ]
  database.specs['prj-deploy'] = [
    { projectId: 'prj-deploy', version: 1, body: DEPLOY_SPEC, updatedAt: minutesAgo(60 * 24 * 20), updatedBy: by('u-admin') },
  ]
  database.changeRequests.push({
    id: 'cr-1',
    projectId: 'prj-auth',
    content: '## 세션 정책\n\n- 외부망 세션은 30분 동안 활동이 없으면 만료합니다.',
    reason: '보안 점검에서 세션 만료 정책을 기획서에 적으라는 지적이 있었습니다.',
    requester: ref('u-01'),
    status: 'OPEN',
    rejectReason: null,
    createdAt: minutesAgo(180),
    decidedAt: null,
  })
  database.documents.push(
    { id: 'doc-readme', projectId: 'prj-auth', title: 'README', path: 'docs/README.md', currentVersion: 2, updatedAt: minutesAgo(600) },
    { id: 'doc-api', projectId: 'prj-auth', title: '인증 API 가이드', path: 'docs/api-guide.md', currentVersion: 1, updatedAt: minutesAgo(60 * 24 * 10) },
  )
  const readmeV2 = `${AUTH_FILES['docs/README.md']}\n## 장애 대응\n\n세션 저장소 장애 시 인프라팀에 연락합니다.\n`
  database.docVersions.push(
    { documentId: 'doc-readme', version: 1, body: AUTH_FILES['docs/README.md'], createdAt: minutesAgo(60 * 24 * 30), createdBy: by('u-admin'), requestId: null },
    { documentId: 'doc-readme', version: 2, body: readmeV2, createdAt: minutesAgo(600), createdBy: by('u-01'), requestId: 'r-completed' },
    { documentId: 'doc-api', version: 1, body: AUTH_FILES['docs/api-guide.md'], createdAt: minutesAgo(60 * 24 * 10), createdBy: by('u-mgr-be'), requestId: null },
  )
  database.forbiddenRules.push(
    { id: 'rule-1', departmentId: 'd-backend', taskType: 'DB', target: 'prod', reason: '운영 DB 스키마는 AI 작업으로 바꾸지 않습니다', status: 'ACTIVE', createdAt: minutesAgo(60 * 24 * 14) },
    { id: 'rule-2', departmentId: 'd-infra', taskType: 'DEPLOY', target: 'production', reason: '운영 배포는 변경 관리 절차로만 합니다', status: 'ACTIVE', createdAt: minutesAgo(60 * 24 * 14) },
  )
  for (const rule of database.forbiddenRules) {
    database.webshell.policy.forbiddenRules.push({
      departmentId: rule.departmentId,
      taskType: rule.taskType,
      target: rule.target,
    })
  }
  database.proposals.push({
    id: 'fp-1',
    departmentId: 'd-backend',
    taskType: 'DATA_WRITE',
    target: 'users',
    reason: '사용자 테이블은 AI 작업으로 직접 수정하지 않습니다',
    status: 'OPEN',
    proposer: ref('u-mgr-be'),
    rejectReason: null,
    createdAt: minutesAgo(240),
  })
}

// ── 요청 시드 도우미 ───────────────────────────────────────

interface SeedTask {
  id?: string
  type: TaskType
  title: string
  target: string
  content: TaskContent
  status: TaskStatus
  description?: string
  risk?: Risk
  riskRaised?: Task['riskRaised']
  forbiddenReason?: string
  relatedDepartments?: string[]
  previousBody?: string
}

const PATHS: Partial<Record<RequestStatus, RequestStatus[]>> = {
  ANALYZING: ['ANALYZING'],
  ANALYSIS_FAILED: ['ANALYZING', 'ANALYSIS_FAILED'],
  REVIEWING: ['ANALYZING', 'REVIEWING'],
  PENDING_APPROVAL: ['ANALYZING', 'REVIEWING', 'PENDING_APPROVAL'],
  REAPPROVAL_REQUIRED: ['ANALYZING', 'REVIEWING', 'PENDING_APPROVAL', 'ANALYZING', 'REAPPROVAL_REQUIRED'],
  VERIFICATION_FAILED: ['ANALYZING', 'REVIEWING', 'PENDING_APPROVAL', 'VERIFICATION_FAILED'],
  REJECTED: ['ANALYZING', 'REVIEWING', 'PENDING_APPROVAL', 'REJECTED'],
  CANCELED: ['ANALYZING', 'REVIEWING', 'CANCELED'],
  RUNNING: ['ANALYZING', 'REVIEWING', 'PENDING_APPROVAL', 'RUNNING'],
  KILLED: ['ANALYZING', 'REVIEWING', 'PENDING_APPROVAL', 'RUNNING', 'KILLED'],
  COMPLETED: ['ANALYZING', 'REVIEWING', 'PENDING_APPROVAL', 'RUNNING', 'COMPLETED'],
  PARTIALLY_COMPLETED: ['ANALYZING', 'REVIEWING', 'PENDING_APPROVAL', 'RUNNING', 'PARTIALLY_COMPLETED'],
  FAILED: ['ANALYZING', 'REVIEWING', 'PENDING_APPROVAL', 'RUNNING', 'FAILED'],
  ROLLING_BACK: ['ANALYZING', 'REVIEWING', 'PENDING_APPROVAL', 'RUNNING', 'COMPLETED', 'PENDING_APPROVAL', 'ROLLING_BACK'],
  ROLLED_BACK: ['ANALYZING', 'REVIEWING', 'PENDING_APPROVAL', 'RUNNING', 'COMPLETED', 'PENDING_APPROVAL', 'ROLLING_BACK', 'ROLLED_BACK'],
  ROLLBACK_FAILED: ['ANALYZING', 'REVIEWING', 'PENDING_APPROVAL', 'RUNNING', 'COMPLETED', 'PENDING_APPROVAL', 'ROLLING_BACK', 'ROLLBACK_FAILED'],
}

interface SeedRequest {
  id: string
  requesterId: string
  projectId?: string
  prompt: string
  status: RequestStatus
  ageMinutes: number
  tasks?: SeedTask[]
  source?: RequestSource
  kind?: 'NORMAL' | 'ROLLBACK'
  /** 타이머를 돌리지 않고 이 상태로 멈춰 둔다 */
  frozen?: boolean
}

function addRequest(seed: SeedRequest): StoredRequest {
  const database = db()
  const project = database.projects.find((p) => p.id === (seed.projectId ?? 'prj-auth'))!
  const requester = ref(seed.requesterId)
  const path = PATHS[seed.status] as RequestStatus[]
  const events = path.map((status, index) => ({
    status,
    at: minutesAgo(seed.ageMinutes - index * (seed.ageMinutes / (path.length + 1))),
    by: status === 'ANALYZING' || status === 'PENDING_APPROVAL' ? requester.name : null,
  }))
  const tasks: Task[] = (seed.tasks ?? []).map((task, index) => {
    const risk = task.risk ?? defaultRisk(task.type)
    return {
      id: task.id ?? `t-${index + 1}`,
      order: index + 1,
      type: task.type,
      risk,
      title: task.title,
      description: task.description,
      target: task.target,
      content: task.content,
      relatedDepartments: task.relatedDepartments ?? [project.departmentId],
      requiredApprovers: buildRequiredApprovers(project, requester, task.type, risk),
      status: task.status,
      explanation: explainTask(task),
      ...(task.riskRaised ? { riskRaised: task.riskRaised } : {}),
      ...(task.forbiddenReason ? { forbiddenReason: task.forbiddenReason } : {}),
    }
  })
  const request: StoredRequest = {
    id: seed.id,
    projectId: project.id,
    requester,
    prompt: seed.prompt,
    source: seed.source ?? 'PROMPT',
    status: seed.status,
    analysisAttempts: 1,
    currentPlanId: null,
    createdAt: minutesAgo(seed.ageMinutes),
    updatedAt: events[events.length - 1].at,
    plan: null,
    approvals: [],
    approvalRecords: [],
    webshellEvents: [],
    pendingAnalysis: null,
    submittedAt: path.includes('PENDING_APPROVAL') ? events[path.indexOf('PENDING_APPROVAL')].at : null,
    clarification: null,
    analysisError: null,
    changedTaskIds: [],
    removedTaskTitles: [],
    failedChecks: [],
    rejection: null,
    kill: null,
    events,
    frozen: seed.frozen,
  }
  if (tasks.length > 0) {
    request.plan = makePlan(request.id, project, tasks, seed.kind ?? 'NORMAL')
    request.currentPlanId = request.plan.id
    if (path.includes('PENDING_APPROVAL')) request.plan.planHash = hashService.computePlanHash(request.plan)
    if (path.includes('RUNNING')) request.execution = signedExecution(request, crypto.randomUUID())
  }
  database.requests.push(request)
  return request
}

/** 실제 승인 흐름과 똑같이 서명·봉투를 만들어 넣는다. */
function signFor(request: StoredRequest, userId: string, taskIds: string[], network: Network = 'INTERNAL') {
  const plan = request.plan!
  const user = ref(userId)
  const device = deviceStore.get(userId)
  const at = minutesAgo(Math.max(1, (Date.now() - new Date(request.submittedAt ?? request.createdAt).getTime()) / 60_000 - 1))
  const signed = signingService.sign(userId, {
    planHash: plan.planHash as string,
    requestId: request.id,
    planId: plan.id,
    taskIds,
    approverId: userId,
    keyId: device.keyId as string,
    issuedAt: at,
    nonce: crypto.randomUUID(),
    network,
  })
  request.approvalRecords.push({
    id: crypto.randomUUID(),
    requestId: request.id,
    planId: plan.id,
    planHash: plan.planHash as string,
    taskIds,
    approverId: userId,
    keyId: device.keyId as string,
    network,
    envelope: cryptoService.encryptForWebshell(signed, WEBSHELL_PUBLIC_KEY.encryptionKey),
    createdAt: at,
  })
  for (const taskId of taskIds) {
    const task = plan.tasks.find((t) => t.id === taskId) as Task
    const requirement = task.requiredApprovers[0]
    request.approvals.push({
      planId: plan.id,
      taskId,
      rule: requirement.rule,
      userId,
      name: user.name,
      network,
      at,
      self: userId === request.requester.id,
    })
  }
}

function addLogs(requestId: string, lines: Array<[LogLine['level'], string | null, string]>, ageMinutes: number) {
  db().logs[requestId] = lines.map(([level, taskId, text], index) =>
    signLogLine(requestId, {
      seq: index + 1,
      at: minutesAgo(ageMinutes - index * 0.1),
      level,
      taskId,
      text,
    }),
  )
}

function auditEntry(
  ageMinutes: number,
  actorId: string,
  action: AuditAction,
  target: AuditLog['target'],
  network: Network = 'INTERNAL',
  detail: Record<string, unknown> = {},
) {
  const database = db()
  const actor = actorId === 'system' ? SYSTEM_ACTOR : ref(actorId)
  database.seq += 1
  database.auditLogs.push({
    id: `log-${database.seq}`,
    at: minutesAgo(ageMinutes),
    actor: { id: actor.id, name: actor.name },
    action,
    target,
    network,
    ip: ipFor(network),
    detail,
  })
}

const loginDiff = () =>
  makeUnifiedDiff(
    'src/auth/login.ts',
    AUTH_FILES['src/auth/login.ts'],
    AUTH_FILES['src/auth/login.ts'].replace('Invalid credentials', '아이디 또는 비밀번호가 올바르지 않습니다'),
  )
const sessionDiff = () =>
  makeUnifiedDiff(
    'src/auth/session.ts',
    AUTH_FILES['src/auth/session.ts'],
    AUTH_FILES['src/auth/session.ts'].replace('60 * 15', '60 * 30'),
  )
const testDiff = () =>
  makeUnifiedDiff(
    'tests/login.test.ts',
    AUTH_FILES['tests/login.test.ts'],
    AUTH_FILES['tests/login.test.ts'].replace(
      "  it('rejects a wrong password'",
      "  it('rejects an unknown user', async () => {\n    expect(loginRoute).toBeDefined()\n  })\n\n  it('rejects a wrong password'",
    ),
  )
const deployTask = (status: TaskStatus, target = 'staging'): SeedTask => ({
  type: 'DEPLOY',
  title: target === 'staging' ? '스테이징 배포' : '운영 배포',
  description: `${target} 환경에 배포합니다.`,
  target,
  content: { command: `./deploy.sh ${target}` },
  status,
  relatedDepartments: ['d-backend', 'd-infra'],
})
const loginTask = (status: TaskStatus): SeedTask => ({
  type: 'CODE_FEATURE',
  title: '로그인 실패 메시지 변경',
  description: '로그인 실패 시 보여 주는 에러 문구를 사용자가 이해하기 쉬운 한국어로 바꿉니다.',
  target: 'src/auth/login.ts',
  content: { diff: loginDiff() },
  status,
})
const testTask = (status: TaskStatus): SeedTask => ({
  type: 'CODE_MINOR',
  title: '로그인 테스트 보강',
  description: '없는 사용자에 대한 테스트를 추가합니다.',
  target: 'tests/login.test.ts',
  content: { diff: testDiff() },
  status,
})
const docTask = (status: TaskStatus, body: string): SeedTask => ({
  type: 'DOC',
  title: 'README 장애 대응 절차 추가',
  description: 'AI가 문서를 끝까지 작성했습니다. 완성본을 보고 적용 여부를 정합니다.',
  target: 'docs/README.md',
  content: { body },
  status,
  previousBody: AUTH_FILES['docs/README.md'],
})

function seedRequests() {
  const README_NEXT = `${AUTH_FILES['docs/README.md']}\n## 장애 대응\n\n세션 저장소 장애 시 인프라팀에 연락합니다.\n`

  // 기본 요청 (API 명세서 예시): t-1은 본인 승인 완료, t-2는 담당자 승인 대기
  const main = addRequest({
    id: 'r-main',
    requesterId: 'u-01',
    prompt: '로그인 실패 시 에러 메시지를 바꾸고 스테이징에 배포해줘',
    status: 'PENDING_APPROVAL',
    ageMinutes: 42,
    tasks: [loginTask('APPROVED'), deployTask('PENDING')],
  })
  signFor(main, 'u-01', ['t-1'])

  addRequest({ id: 'r-analyzing', requesterId: 'u-01', prompt: '비밀번호 재설정 메일 문구를 다듬어줘', status: 'ANALYZING', ageMinutes: 1, frozen: true })

  addRequest({ id: 'r-analysis-failed', requesterId: 'u-01', prompt: '결제 모듈 연동 테스트를 추가해줘', status: 'ANALYSIS_FAILED', ageMinutes: 25 }).analysisError =
    'AI 분석 엔진이 응답하지 않았습니다'

  addRequest({
    id: 'r-reviewing',
    requesterId: 'u-01',
    prompt: '로그인 테스트를 보강하고 세션 만료를 30분으로 늘려줘',
    status: 'REVIEWING',
    ageMinutes: 18,
    tasks: [
      testTask('PENDING'),
      {
        type: 'CODE_FEATURE',
        title: '세션 만료 시간 변경',
        description: '세션 만료를 15분에서 30분으로 늘립니다.',
        target: 'src/auth/session.ts',
        content: { diff: sessionDiff() },
        status: 'PENDING',
        risk: 'HIGH',
        riskRaised: { from: 'MEDIUM', reason: '인증 로직을 건드리는 변경입니다' },
      },
    ],
  })

  addRequest({ id: 'r-clarify', requesterId: 'u-01', prompt: '이거 좀 알아서 고쳐줘', status: 'REVIEWING', ageMinutes: 12 }).clarification = {
    question: '어떤 동작을 어떻게 바꾸면 될까요? 대상 기능과 바라는 결과를 알려 주세요.',
  }

  addRequest({
    id: 'r-forbidden',
    requesterId: 'u-01',
    prompt: '운영 DB에 컬럼을 추가하고 로그인 테스트를 보강해줘',
    status: 'REVIEWING',
    ageMinutes: 30,
    tasks: [
      {
        type: 'DB',
        title: '운영 DB 스키마 변경',
        description: 'users 테이블에 컬럼을 추가합니다.',
        target: 'prod-db',
        content: { query: 'ALTER TABLE users ADD COLUMN last_login_at timestamptz;' },
        status: 'BLOCKED',
        risk: 'FORBIDDEN',
        forbiddenReason: '운영 DB 스키마는 AI 작업으로 바꾸지 않습니다',
      },
      testTask('PENDING'),
    ],
  })

  // 재승인필요: t-1이 바뀌어 기존 서명이 무효가 된 상태
  const reapproval = addRequest({
    id: 'r-reapproval',
    requesterId: 'u-01',
    prompt: '로그인 실패 메시지를 한국어와 영어로 보여주고 스테이징에 배포해줘',
    status: 'REAPPROVAL_REQUIRED',
    ageMinutes: 95,
    tasks: [
      {
        ...loginTask('PENDING'),
        content: { diff: `${loginDiff()}\n+// 수정 지시: 메시지를 한국어와 영어 둘 다 보여줘` },
        description: '로그인 실패 시 보여 주는 문구를 바꿉니다. 수정 지시: 메시지를 한국어와 영어 둘 다 보여줘',
      },
      deployTask('PENDING'),
    ],
  })
  reapproval.changedTaskIds = ['t-1']

  const verificationFailed = addRequest({
    id: 'r-verify-failed',
    requesterId: 'u-01',
    prompt: '세션 토큰 서명 키 교체 스크립트를 실행하고 스테이징에 배포해줘',
    status: 'VERIFICATION_FAILED',
    ageMinutes: 200,
    tasks: [
      {
        type: 'CODE_FEATURE',
        title: '토큰 서명 키 교체',
        target: 'src/auth/token.ts',
        content: { diff: makeUnifiedDiff('src/auth/token.ts', AUTH_FILES['src/auth/token.ts'], `${AUTH_FILES['src/auth/token.ts']}\n// rotate key\n`) },
        status: 'APPROVED',
        risk: 'HIGH',
        riskRaised: { from: 'MEDIUM', reason: '인증 로직을 건드리는 변경입니다' },
      },
      deployTask('APPROVED'),
    ],
  })
  verificationFailed.failedChecks = ['PLAN_HASH_MISMATCH', 'MISSING_REQUIRED_APPROVER'] satisfies FailedCheck[]

  const running = addRequest({
    id: 'r-running',
    requesterId: 'u-01',
    prompt: '스테이징 DB에 last_login_at 컬럼을 추가하는 마이그레이션을 돌려줘',
    status: 'RUNNING',
    ageMinutes: 8,
    tasks: [
      testTask('SUCCEEDED'),
      {
        id: 't-long',
        type: 'DB',
        title: '스테이징 DB 마이그레이션',
        description: 'users 테이블에 last_login_at 컬럼을 추가합니다.',
        target: 'staging-db',
        content: { query: 'ALTER TABLE users ADD COLUMN last_login_at timestamptz;' },
        status: 'RUNNING',
      },
      deployTask('APPROVED'),
    ],
  })
  signFor(running, 'u-01', ['t-1'])
  signFor(running, 'u-07', ['t-long', 't-3'])
  running.execStepMs = 2000
  running.execLine = 2
  addLogs(
    running.id,
    [
      ['INFO', null, '[웹쉘] 승인 서명 검증 통과. 1회용 ID 소진, 전용 세션을 엽니다'],
      ['INFO', 't-1', '[t-1] 로그인 테스트 보강 시작'],
      ['CMD', 't-1', '$ git apply tests_login.test.ts.patch'],
      ['SUCCESS', 't-1', '[t-1] 성공'],
      ['INFO', 't-long', '[t-long] 스테이징 DB 마이그레이션 시작'],
      ['CMD', 't-long', '$ npm run migrate:up'],
    ],
    4,
  )

  const completed = addRequest({
    id: 'r-completed',
    requesterId: 'u-01',
    prompt: 'README에 장애 대응 절차를 적고 로그인 테스트를 보강해줘',
    status: 'COMPLETED',
    ageMinutes: 620,
    tasks: [docTask('SUCCEEDED', README_NEXT), testTask('SUCCEEDED')],
  })
  signFor(completed, 'u-01', ['t-1'])
  signFor(completed, 'u-07', ['t-2'], 'EXTERNAL')
  addLogs(
    completed.id,
    [
      ['INFO', null, '[웹쉘] 승인 서명 검증 통과. 1회용 ID 소진, 전용 세션을 엽니다'],
      ['INFO', 't-1', '[t-1] README 장애 대응 절차 추가 시작'],
      ['INFO', 't-1', '문서 새 버전 저장'],
      ['SUCCESS', 't-1', '[t-1] 성공'],
      ['INFO', 't-2', '[t-2] 로그인 테스트 보강 시작'],
      ['CMD', 't-2', '$ npm test'],
      ['INFO', 't-2', 'Tests  43 passed (43)'],
      ['SUCCESS', 't-2', '[t-2] 성공'],
      ['INFO', null, '[웹쉘] 전용 세션을 닫습니다'],
    ],
    600,
  )

  const partial = addRequest({
    id: 'r-partial',
    requesterId: 'u-01',
    prompt: '로그인 메시지를 바꾸고 스테이징에 배포해줘',
    status: 'PARTIALLY_COMPLETED',
    ageMinutes: 340,
    tasks: [loginTask('SUCCEEDED'), deployTask('FAILED')],
  })
  signFor(partial, 'u-07', ['t-1'], 'EXTERNAL')
  signFor(partial, 'u-07', ['t-2'])
  addLogs(
    partial.id,
    [
      ['INFO', null, '[웹쉘] 승인 서명 검증 통과. 1회용 ID 소진, 전용 세션을 엽니다'],
      ['INFO', 't-1', '[t-1] 로그인 실패 메시지 변경 시작'],
      ['SUCCESS', 't-1', '[t-1] 성공'],
      ['INFO', 't-2', '[t-2] 스테이징 배포 시작'],
      ['CMD', 't-2', '$ ./deploy.sh staging'],
      ['ERROR', 't-2', 'error: rollout timed out after 300s'],
      ['ERROR', 't-2', '[t-2] 실패: 종료 코드 1'],
      ['INFO', null, '[웹쉘] 전용 세션을 닫습니다'],
    ],
    320,
  )

  const killed = addRequest({
    id: 'r-killed',
    requesterId: 'u-01',
    prompt: '로그인 메시지를 바꾸고 스테이징에 배포해줘 (잘못된 브랜치)',
    status: 'KILLED',
    ageMinutes: 480,
    tasks: [loginTask('SUCCEEDED'), deployTask('SKIPPED')],
  })
  signFor(killed, 'u-01', ['t-1'])
  signFor(killed, 'u-07', ['t-2'])
  killed.kill = { by: '홍길동', reason: '잘못된 브랜치에 배포 중', at: minutesAgo(470), skippedTaskIds: ['t-2'] }
  addLogs(
    killed.id,
    [
      ['INFO', null, '[웹쉘] 승인 서명 검증 통과. 1회용 ID 소진, 전용 세션을 엽니다'],
      ['INFO', 't-1', '[t-1] 로그인 실패 메시지 변경 시작'],
      ['SUCCESS', 't-1', '[t-1] 성공'],
      ['ERROR', null, '[웹쉘] 킬 스위치로 중단했습니다'],
    ],
    471,
  )

  const rejected = addRequest({
    id: 'r-rejected',
    requesterId: 'u-01',
    prompt: '오래된 사용자 데이터를 일괄 수정해줘',
    status: 'REJECTED',
    ageMinutes: 800,
    tasks: [
      {
        type: 'DATA_WRITE',
        title: '운영 데이터 수정',
        description: '1년 이상 접속하지 않은 사용자를 휴면으로 바꿉니다.',
        target: 'prod-db',
        content: { query: "UPDATE users SET status = 'dormant' WHERE last_login_at < now() - interval '1 year';" },
        status: 'REJECTED',
      },
    ],
  })
  rejected.rejection = { by: '김담당', reason: '법무 검토가 끝난 뒤 다시 요청해 주세요', at: minutesAgo(780), taskIds: ['t-1'] }

  addRequest({ id: 'r-canceled', requesterId: 'u-01', prompt: '세션 로그 포맷을 바꿔줘', status: 'CANCELED', ageMinutes: 1400, tasks: [testTask('PENDING')] })

  const failed = addRequest({
    id: 'r-failed',
    requesterId: 'u-21',
    projectId: 'prj-deploy',
    prompt: '스테이징 배포 스크립트를 돌려줘',
    status: 'FAILED',
    ageMinutes: 1000,
    tasks: [{ ...deployTask('FAILED'), relatedDepartments: ['d-infra'] }],
  })
  addLogs(
    failed.id,
    [
      ['INFO', null, '[웹쉘] 승인 서명 검증 통과. 1회용 ID 소진, 전용 세션을 엽니다'],
      ['CMD', 't-1', '$ ./deploy.sh staging'],
      ['ERROR', 't-1', 'error: cluster unreachable'],
      ['ERROR', 't-1', '[t-1] 실패: 종료 코드 1'],
      ['INFO', null, '[웹쉘] 전용 세션을 닫습니다'],
    ],
    990,
  )

  const rollbackTask = (status: TaskStatus): SeedTask => ({
    type: 'DOC',
    title: '문서 롤백: 인증 API 가이드 v2 → v1',
    description: '적용된 문서를 이전 버전으로 되돌립니다.',
    target: 'docs/api-guide.md',
    content: { body: AUTH_FILES['docs/api-guide.md'] },
    status,
  })
  addRequest({ id: 'r-rolling-back', requesterId: 'u-01', prompt: '인증 API 가이드 오탈자를 고쳐줘', status: 'ROLLING_BACK', ageMinutes: 60, kind: 'ROLLBACK', frozen: true, tasks: [rollbackTask('RUNNING')] })
  addRequest({ id: 'r-rolled-back', requesterId: 'u-01', prompt: '인증 API 가이드에 예시를 추가해줘', status: 'ROLLED_BACK', ageMinutes: 2000, kind: 'ROLLBACK', tasks: [rollbackTask('ROLLED_BACK')] })
  addRequest({ id: 'r-rollback-failed', requesterId: 'u-01', prompt: '인증 API 가이드 구조를 바꿔줘', status: 'ROLLBACK_FAILED', ageMinutes: 2600, kind: 'ROLLBACK', tasks: [rollbackTask('FAILED')] })

  // 김담당도 본인 요청이 있어야 "내 대시보드"가 비지 않는다.
  addRequest({ id: 'r-kim-review', requesterId: 'u-07', prompt: '세션 만료 안내 문구를 다듬어줘', status: 'REVIEWING', ageMinutes: 35, tasks: [testTask('PENDING')] })
  const kimDone = addRequest({
    id: 'r-kim-done',
    requesterId: 'u-07',
    prompt: '로그인 테스트를 보강해줘',
    status: 'COMPLETED',
    ageMinutes: 300,
    tasks: [testTask('SUCCEEDED')],
  })
  signFor(kimDone, 'u-07', ['t-1'])
  addLogs(
    kimDone.id,
    [
      ['INFO', null, '[웹쉘] 승인 서명 검증 통과. 1회용 ID 소진, 전용 세션을 엽니다'],
      ['CMD', 't-1', '$ npm test'],
      ['INFO', 't-1', 'Tests  43 passed (43)'],
      ['SUCCESS', 't-1', '[t-1] 성공'],
      ['INFO', null, '[웹쉘] 전용 세션을 닫습니다'],
    ],
    290,
  )

  // 승인 대기 시연용: 외부망 승인, 문서 적용, 무결성 실패
  addRequest({
    id: 'r-external',
    requesterId: 'u-21',
    prompt: '로그인 테스트를 보강하고 스테이징에 배포해줘',
    status: 'PENDING_APPROVAL',
    ageMinutes: 130,
    tasks: [testTask('PENDING'), deployTask('PENDING')],
  })
  addRequest({
    id: 'r-high-code',
    requesterId: 'u-mgr-be',
    prompt: '토큰 서명 알고리즘을 바꿔줘',
    status: 'PENDING_APPROVAL',
    ageMinutes: 75,
    tasks: [
      {
        type: 'CODE_FEATURE',
        title: '토큰 서명 알고리즘 변경',
        description: 'HMAC-SHA256을 HMAC-SHA512로 바꿉니다.',
        target: 'src/auth/token.ts',
        content: {
          diff: makeUnifiedDiff('src/auth/token.ts', AUTH_FILES['src/auth/token.ts'], AUTH_FILES['src/auth/token.ts'].replace("'sha256'", "'sha512'")),
        },
        status: 'PENDING',
        risk: 'HIGH',
        riskRaised: { from: 'MEDIUM', reason: '인증 로직을 건드리는 변경입니다' },
      },
    ],
  })
  addRequest({
    id: 'r-doc',
    requesterId: 'u-mgr-be',
    prompt: '인증 API 가이드에 오류 응답 표를 추가해줘',
    status: 'PENDING_APPROVAL',
    ageMinutes: 55,
    tasks: [
      {
        type: 'DOC',
        title: '인증 API 가이드 오류 응답 표 추가',
        description: 'AI가 문서를 끝까지 작성했습니다. 완성본을 보고 적용 여부를 정합니다.',
        target: 'docs/api-guide.md',
        content: {
          body: `${AUTH_FILES['docs/api-guide.md']}\n## 오류 응답\n\n| 코드 | 뜻 |\n|---|---|\n| 401 | 사번 또는 비밀번호가 맞지 않음 |\n`,
        },
        previousBody: AUTH_FILES['docs/api-guide.md'],
        status: 'PENDING',
      },
    ],
  })

  // 웹 서비스가 Plan을 바꿔치기한 경우: 저장된 해시는 그대로인데 내용만 바뀌었다.
  const tamperedHash = addRequest({
    id: 'r-tampered-hash',
    requesterId: 'u-21',
    prompt: '스테이징에 배포해줘',
    status: 'PENDING_APPROVAL',
    ageMinutes: 22,
    tasks: [{ ...deployTask('PENDING'), title: '인증 서비스 스테이징 배포' }],
  })
  tamperedHash.plan!.tasks[0].content = { command: './deploy.sh production --force' }

  // 웹 서비스가 화면과 다른 내용에 서명받으려는 경우: 해시는 해시 대상과 맞지만, 화면의 Plan은 해시 대상과 다르다.
  const displayMismatch = addRequest({
    id: 'r-display-mismatch',
    requesterId: 'u-21',
    prompt: '스테이징 재배포해줘',
    status: 'PENDING_APPROVAL',
    ageMinutes: 16,
    tasks: [{ ...deployTask('PENDING'), title: '스테이징 재배포' }],
  })
  const forged = toHashTarget(displayMismatch.plan!)
  forged.tasks[0] = { ...forged.tasks[0], target: 'production', content: { command: './deploy.sh production --force' } }
  displayMismatch.forgedHashTarget = forged
  displayMismatch.plan!.planHash = hashService.computeTargetHash(forged)
}

function seedAudit() {
  auditEntry(44, 'u-01', 'REQUEST_CREATED', { requestId: 'r-main', projectId: 'prj-auth' })
  auditEntry(41, 'u-01', 'SUBMITTED', { requestId: 'r-main' })
  auditEntry(41, 'u-01', 'APPROVAL_SUBMITTED', { requestId: 'r-main', taskIds: ['t-1'] }, 'INTERNAL', { keyId: 'k-01-a', self: true })
  auditEntry(610, 'u-07', 'LOGIN', { label: 'E1107' }, 'EXTERNAL')
  auditEntry(608, 'u-07', 'APPROVAL_SUBMITTED', { requestId: 'r-completed', taskIds: ['t-2'] }, 'EXTERNAL', { keyId: 'k-07-a' })
  auditEntry(330, 'u-07', 'LOGIN', { label: 'E1107' }, 'EXTERNAL')
  auditEntry(328, 'u-07', 'APPROVAL_SUBMITTED', { requestId: 'r-partial', taskIds: ['t-1'] }, 'EXTERNAL', { keyId: 'k-07-a' })
  auditEntry(605, 'system', 'EXECUTION_STARTED', { requestId: 'r-completed', taskIds: ['t-1', 't-2'] })
  auditEntry(600, 'system', 'TASK_SUCCEEDED', { requestId: 'r-completed', taskIds: ['t-1'] })
  auditEntry(599, 'system', 'TASK_SUCCEEDED', { requestId: 'r-completed', taskIds: ['t-2'] })
  auditEntry(320, 'system', 'TASK_FAILED', { requestId: 'r-partial', taskIds: ['t-2'] })
  auditEntry(471, 'u-01', 'KILLED', { requestId: 'r-killed', taskIds: ['t-2'] }, 'EXTERNAL', { reason: '잘못된 브랜치에 배포 중' })
  auditEntry(190, 'system', 'VERIFICATION_FAILED', { requestId: 'r-verify-failed' }, 'INTERNAL', {
    failedChecks: ['PLAN_HASH_MISMATCH', 'MISSING_REQUIRED_APPROVER'],
  })
  auditEntry(780, 'u-07', 'REJECTED', { requestId: 'r-rejected', taskIds: ['t-1'] }, 'INTERNAL', { reason: '법무 검토가 끝난 뒤 다시 요청해 주세요' })
  auditEntry(240, 'u-mgr-be', 'FORBIDDEN_RULE_PROPOSED', { label: 'DATA_WRITE users' })
  auditEntry(60 * 24 * 14, 'u-admin', 'FORBIDDEN_RULE_CONFIRMED', { label: 'DB prod' })
  auditEntry(60 * 24 * 6, 'u-admin', 'KEY_REGISTERED', { label: '김담당 k-07-a' })
  auditEntry(60 * 24 * 3, 'u-mgr-be', 'SPEC_UPDATED', { projectId: 'prj-auth', label: '기획서 v2' })
  auditEntry(990, 'system', 'TASK_FAILED', { requestId: 'r-failed', taskIds: ['t-1'] })
  auditEntry(130, 'u-21', 'SUBMITTED', { requestId: 'r-external' })
  auditEntry(300, 'u-07', 'REQUEST_CREATED', { requestId: 'r-kim-done', projectId: 'prj-auth' })
  auditEntry(295, 'u-07', 'APPROVAL_SUBMITTED', { requestId: 'r-kim-done', taskIds: ['t-1'] }, 'INTERNAL', { keyId: 'k-07-a', self: true })
  auditEntry(290, 'system', 'TASK_SUCCEEDED', { requestId: 'r-kim-done', taskIds: ['t-1'] })
  auditEntry(35, 'u-07', 'REQUEST_CREATED', { requestId: 'r-kim-review', projectId: 'prj-auth' })
  db().auditLogs.sort((a, b) => b.at.localeCompare(a.at))
}

export function buildSeed() {
  setDb(emptyDb())
  seedPeople()
  seedProjects()
  seedRequests()
  seedAudit()
}

export { DEMO_PASSWORD }
