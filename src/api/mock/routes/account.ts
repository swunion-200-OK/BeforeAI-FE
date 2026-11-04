import type { Me, SigningKey } from '../../types'
import { EXECUTOR_PUBLIC_KEY } from '../executor'
import { paginate, route, type Route } from '../router'
import { HttpError, audit, db, nextId, nowIso, requireUser, type StoredUser } from '../store'

export const INITIAL_PASSWORD = 'welcome1!'
export const DEMO_OTP = '123456'

export function issueToken(userId: string) {
  return `mock.${userId}.${Date.now()}`
}

export function userFromToken(token: string | null): StoredUser | null {
  const match = token && /^Bearer mock\.([^.]+)\./.exec(token)
  if (!match) return null
  const user = db().users.find((u) => u.id === match[1])
  return user?.active ? user : null
}

function startSession(user: StoredUser) {
  db().session = { userId: user.id, lastActiveAt: Date.now() }
  audit(user, 'LOGIN', { label: user.employeeNo })
  return { accessToken: issueToken(user.id), mustChangePassword: user.mustChangePassword }
}

function publicUser(user: StoredUser) {
  const { password: _password, otpEnrolled: _otpEnrolled, ...rest } = user
  return rest
}

export function toMe(user: StoredUser): Me {
  const database = db()
  const keys = database.signingKeys.filter((k) => k.userId === user.id && k.status !== 'REVOKED')
  const status: Me['signingKeyStatus'] = keys.some((k) => k.status === 'REGISTERED')
    ? 'REGISTERED'
    : keys.length > 0
      ? 'PENDING'
      : 'NONE'
  return {
    ...publicUser(user),
    network: database.network,
    signingKeyStatus: status,
    otpEnrolled: user.otpEnrolled,
  }
}

export const accountRoutes: Route[] = [
  // ── 인증 ────────────────────────────────────────────────
  route(
    'POST',
    '/auth/login',
    ({ body, network }) => {
      const user = db().users.find((u) => u.employeeNo === body.employeeNo && u.password === body.password)
      if (!user || !user.active) {
        throw new HttpError(400, 'VALIDATION_ERROR', '사번 또는 비밀번호가 맞지 않습니다')
      }
      if (network === 'EXTERNAL') return { otpRequired: true, tempToken: `otp.${user.id}` }
      return { otpRequired: false, ...startSession(user) }
    },
    { anonymous: true },
  ),
  route(
    'POST',
    '/auth/otp/verify',
    ({ body }) => {
      const match = /^otp\.(.+)$/.exec(body.tempToken ?? '')
      if (!match) throw new HttpError(401, 'UNAUTHENTICATED', '다시 로그인해 주세요')
      if (body.code !== DEMO_OTP) throw new HttpError(400, 'VALIDATION_ERROR', 'OTP 번호가 맞지 않습니다')
      return startSession(requireUser(match[1]))
    },
    { anonymous: true },
  ),
  route(
    'POST',
    '/auth/refresh',
    () => {
      const session = db().session
      if (!session) throw new HttpError(401, 'UNAUTHENTICATED', '로그인이 필요합니다')
      const user = requireUser(session.userId)
      return { accessToken: issueToken(user.id), mustChangePassword: user.mustChangePassword }
    },
    { anonymous: true },
  ),
  route(
    'POST',
    '/auth/logout',
    () => {
      db().session = null
    },
    { anonymous: true },
  ),

  // ── 내 정보·승인 키 ─────────────────────────────────────
  route('GET', '/me', ({ me }) => toMe(me)),
  route(
    'PUT',
    '/me/password',
    ({ me, body }) => {
      if (me.password !== body.currentPassword) {
        throw new HttpError(400, 'VALIDATION_ERROR', '현재 비밀번호가 맞지 않습니다')
      }
      if (!body.newPassword || body.newPassword.length < 8) {
        throw new HttpError(400, 'VALIDATION_ERROR', '새 비밀번호는 8자 이상이어야 합니다')
      }
      me.password = body.newPassword
      me.mustChangePassword = false
      audit(me, 'ACCOUNT_CHANGED', { label: '비밀번호 변경' })
    },
    { internal: true },
  ),
  route(
    'POST',
    '/me/otp',
    ({ me, body }) => {
      if (body.code === undefined || body.code === null) return { secret: 'JBSWY3DPEHPK3PXP', enrolled: me.otpEnrolled }
      if (body.code !== DEMO_OTP) throw new HttpError(400, 'VALIDATION_ERROR', 'OTP 번호가 맞지 않습니다')
      me.otpEnrolled = true
      audit(me, 'ACCOUNT_CHANGED', { label: 'OTP 등록' })
      return { secret: 'JBSWY3DPEHPK3PXP', enrolled: true }
    },
    { internal: true },
  ),
  route(
    'POST',
    '/me/signing-keys',
    ({ me, body }) => {
      const database = db()
      for (const key of database.signingKeys) {
        if (key.userId === me.id && key.status === 'PENDING') key.status = 'REVOKED'
      }
      const key: SigningKey = {
        keyId: nextId('k'),
        userId: me.id,
        userName: me.name,
        publicKey: body.publicKey,
        status: 'PENDING',
        createdAt: nowIso(),
        registeredAt: null,
      }
      database.signingKeys.unshift(key)
      audit(me, 'KEY_SUBMITTED', { label: key.keyId })
      return key
    },
    { internal: true, status: 201 },
  ),
  route('GET', '/me/signing-keys', ({ me, query }) =>
    paginate(
      db().signingKeys.filter((k) => k.userId === me.id),
      query,
    ),
  ),
  route('GET', '/executor/public-key', () => ({ publicKey: EXECUTOR_PUBLIC_KEY }), { internal: true }),
  route('GET', '/me/notification-settings', ({ me }) => db().notificationSettings[me.id]),
  route('PUT', '/me/notification-settings', ({ me, body }) => {
    db().notificationSettings[me.id] = body
    me.slackUserId = body.slackUserId
    return body
  }),

  // ── 관리자: 계정·조직 ───────────────────────────────────
  route(
    'POST',
    '/admin/users',
    ({ me, body }) => {
      const database = db()
      if (!body.employeeNo || !body.name) throw new HttpError(400, 'VALIDATION_ERROR', '사번과 이름을 입력해 주세요')
      if (database.users.some((u) => u.employeeNo === body.employeeNo)) {
        throw new HttpError(400, 'VALIDATION_ERROR', '이미 쓰고 있는 사번입니다')
      }
      const user: StoredUser = {
        id: nextId('u'),
        employeeNo: body.employeeNo,
        name: body.name,
        role: body.role,
        departmentId: body.departmentId ?? null,
        slackUserId: body.slackUserId ?? null,
        active: true,
        mustChangePassword: true,
        password: INITIAL_PASSWORD,
        otpEnrolled: false,
      }
      database.users.push(user)
      database.notificationSettings[user.id] = {
        slackUserId: user.slackUserId,
        approvalRequests: true,
        requestResults: true,
      }
      audit(me, 'ACCOUNT_CHANGED', { label: `계정 생성 ${user.name}` })
      return { user: publicUser(user), initialPassword: INITIAL_PASSWORD }
    },
    { internal: true, roles: ['ADMIN'], status: 201 },
  ),
  route(
    'GET',
    '/admin/users',
    ({ query }) => {
      const departmentId = query.get('departmentId')
      const role = query.get('role')
      const items = db()
        .users.filter((u) => (!departmentId || u.departmentId === departmentId) && (!role || u.role === role))
        .map(publicUser)
      return { items, nextCursor: null }
    },
    // TODO(spec): 팀장도 담당자를 지정하려면 사용자 목록이 필요한데 명세에는 ADMIN만 있다. 읽기만 열어 두었다.
    { internal: true, roles: ['ADMIN', 'DEPT_MANAGER'] },
  ),
  route(
    'PATCH',
    '/admin/users/:userId',
    ({ me, params, body }) => {
      const user = requireUser(params.userId)
      if (body.active === false) {
        // 담당자를 비활성화해서 활성 담당자가 2명 아래로 내려가면 승인할 사람이 없어질 수 있다 (5.8).
        const stranded = db().projects.find(
          (project) =>
            project.owners.some((owner) => owner.id === user.id) &&
            project.owners.filter((owner) => owner.id !== user.id && requireUser(owner.id).active).length < 2,
        )
        if (stranded) {
          throw new HttpError(409, 'OWNER_MINIMUM', `${stranded.name} 담당자를 먼저 바꿔 주세요`, {
            projectId: stranded.id,
          })
        }
      }
      Object.assign(user, body)
      audit(me, 'ACCOUNT_CHANGED', { label: `계정 변경 ${user.name}` }, body)
      return publicUser(user)
    },
    { internal: true, roles: ['ADMIN'] },
  ),
  route(
    'POST',
    '/admin/users/:userId/reset-password',
    ({ me, params }) => {
      const user = requireUser(params.userId)
      user.password = INITIAL_PASSWORD
      user.mustChangePassword = true
      audit(me, 'ACCOUNT_CHANGED', { label: `비밀번호 초기화 ${user.name}` })
      return { initialPassword: INITIAL_PASSWORD }
    },
    { internal: true, roles: ['ADMIN'] },
  ),
  route('GET', '/departments', () => ({ items: db().departments, nextCursor: null })),
  route(
    'POST',
    '/admin/departments',
    ({ me, body }) => {
      if (!body.name?.trim()) throw new HttpError(400, 'VALIDATION_ERROR', '부서 이름을 입력해 주세요')
      const department = { id: nextId('d'), name: body.name.trim() }
      db().departments.push(department)
      audit(me, 'ACCOUNT_CHANGED', { label: `부서 생성 ${department.name}` })
      return department
    },
    { internal: true, roles: ['ADMIN'], status: 201 },
  ),

  // ── 관리자: 정책·키·Slack ───────────────────────────────
  route('GET', '/admin/policy', () => db().policy, { internal: true, roles: ['ADMIN'] }),
  route(
    'PUT',
    '/admin/policy/preset',
    ({ me, body }) => {
      const policy = db().policy
      policy.preset = body.preset
      policy.slackNotifications = body.preset === 'SMALL' ? 'OPTIONAL' : 'ON'
      policy.auditRetention = { SMALL: '90일', MEDIUM: '1년', LARGE: '3년' }[body.preset as 'SMALL' | 'MEDIUM' | 'LARGE']
      audit(me, 'POLICY_CHANGED', { label: `규모 프리셋 ${body.preset}` })
      return policy
    },
    { internal: true, roles: ['ADMIN'] },
  ),
  route('GET', '/approval-matrix', () => db().matrix),
  route(
    'PUT',
    '/admin/approval-matrix',
    ({ me, body }) => {
      db().matrix = body.rows
      audit(me, 'POLICY_CHANGED', { label: '승인 기준표 수정' })
      return db().matrix
    },
    { internal: true, roles: ['ADMIN'] },
  ),
  route('GET', '/admin/signing-keys', () => ({ items: db().signingKeys, nextCursor: null }), {
    internal: true,
    roles: ['ADMIN'],
  }),
  route(
    'POST',
    '/admin/signing-keys/:keyId/register',
    ({ me, params }) => {
      const database = db()
      const key = database.signingKeys.find((k) => k.keyId === params.keyId)
      if (!key) throw new HttpError(404, 'NOT_FOUND', '키를 찾을 수 없습니다')
      if (key.status !== 'PENDING') throw new HttpError(409, 'INVALID_STATE', '등록 대기 상태가 아닙니다')
      key.status = 'REGISTERED'
      key.registeredAt = nowIso()
      database.executor.keys.push({ keyId: key.keyId, userId: key.userId, publicKey: key.publicKey })
      audit(me, 'KEY_REGISTERED', { label: `${key.userName} ${key.keyId}` })
      return key
    },
    { internal: true, roles: ['ADMIN'] },
  ),
  route(
    'DELETE',
    '/admin/signing-keys/:keyId',
    ({ me, params }) => {
      const database = db()
      const key = database.signingKeys.find((k) => k.keyId === params.keyId)
      if (!key) throw new HttpError(404, 'NOT_FOUND', '키를 찾을 수 없습니다')
      key.status = 'REVOKED'
      database.executor.keys = database.executor.keys.filter((k) => k.keyId !== key.keyId)
      audit(me, 'KEY_REVOKED', { label: `${key.userName} ${key.keyId}` })
      return key
    },
    { internal: true, roles: ['ADMIN'] },
  ),
  route(
    'PUT',
    '/admin/integrations/slack',
    ({ me, body }) => {
      db().policy.slackIntegration = body
      audit(me, 'POLICY_CHANGED', { label: 'Slack 연동 설정' })
      return body
    },
    { internal: true, roles: ['ADMIN'] },
  ),
]
