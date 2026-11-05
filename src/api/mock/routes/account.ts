import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { base64ToBytes, bytesToBase64 } from '../../../crypto/encoding'
import { signingService } from '../../../crypto/signingService'
import { canonicalize } from '../../../crypto/hashService'
import type { AdminSigningKey, Me, SigningKey } from '../../types'
import { assertAdminProof, nextPolicyVersion } from '../policy'
import { paginate, route, type Route } from '../router'
import { HttpError, audit, db, nextId, nowIso, requireUser, type StoredUser } from '../store'
import { WEBSHELL_PUBLIC_KEY } from '../webshell'

export const INITIAL_PASSWORD = 'welcome1!'
export const DEMO_OTP = '123456'
const DEMO_OTP_SECRET = 'JBSWY3DPEHPK3PXP'

/** 서버처럼 비밀번호 변경 필요 표시를 토큰에 담는다. 비밀번호를 바꿔도 이미 준 토큰은 그대로다. */
export function issueToken(userId: string) {
  const changeRequired = db().users.find((u) => u.id === userId)?.passwordChangeRequired
  return `mock.${userId}.${Date.now()}${changeRequired ? '.password-change' : ''}`
}

export function isPasswordChangeToken(token: string | null): boolean {
  return Boolean(token?.endsWith('.password-change'))
}

export function userFromToken(token: string | null): StoredUser | null {
  const match = token && /^Bearer mock\.([^.]+)\./.exec(token)
  if (!match) return null
  const user = db().users.find((u) => u.id === match[1])
  return user?.active ? user : null
}

function startSession(user: StoredUser) {
  db().session = { userId: user.id, lastActiveAt: Date.now() }
  audit(user, 'LOGIN', { label: user.employeeNumber })
  return { accessToken: issueToken(user.id) }
}

function publicUser(user: StoredUser) {
  const { password: _password, passwordChangeRequired: _changeRequired, otpEnrolled: _otpEnrolled, otpSecret: _otpSecret, ...rest } = user
  return rest
}

export function toMe(user: StoredUser): Me {
  const database = db()
  return {
    ...publicUser(user),
    network: database.network,
    passwordChangeRequired: user.passwordChangeRequired,
    hasRegisteredSigningKey: database.signingKeys.some((k) => k.userId === user.id && k.status === 'REGISTERED'),
  }
}

/** /me/signing-keys는 키 주인을 싣지 않는다. */
function ownKeyView({ userId: _userId, ...key }: AdminSigningKey): SigningKey {
  return key
}

function assertEd25519PublicKey(publicKey: unknown) {
  let raw: Uint8Array
  try {
    raw = base64ToBytes(String(publicKey))
  } catch {
    throw new HttpError(400, 'VALIDATION_ERROR', '공개키 형식이 올바르지 않습니다')
  }
  if (raw.length !== 32 || bytesToBase64(raw) !== publicKey) {
    throw new HttpError(400, 'VALIDATION_ERROR', '공개키 형식이 올바르지 않습니다')
  }
}

export const accountRoutes: Route[] = [
  // ── 인증 ────────────────────────────────────────────────
  route(
    'POST',
    '/auth/login',
    ({ body, network }) => {
      const user = db().users.find((u) => u.employeeNumber === body.employeeNumber && u.password === body.password)
      if (!user || !user.active) {
        throw new HttpError(401, 'UNAUTHENTICATED', '사번 또는 비밀번호가 올바르지 않습니다')
      }
      if (network === 'EXTERNAL') {
        if (!user.otpEnrolled) {
          throw new HttpError(401, 'UNAUTHENTICATED', '외부망 로그인에는 OTP 등록이 필요합니다. 내부망에서 먼저 등록해 주세요')
        }
        return { otpRequired: true, temporaryToken: `otp.${user.id}` }
      }
      return { otpRequired: false, ...startSession(user), passwordChangeRequired: user.passwordChangeRequired }
    },
    { anonymous: true },
  ),
  route(
    'POST',
    '/auth/otp/verify',
    ({ body }) => {
      const match = /^otp\.(.+)$/.exec(body.temporaryToken ?? '')
      if (!match) throw new HttpError(401, 'UNAUTHENTICATED', '다시 로그인해 주세요')
      if (body.otpCode !== DEMO_OTP) throw new HttpError(401, 'UNAUTHENTICATED', 'OTP 코드가 올바르지 않습니다')
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
      return { accessToken: issueToken(user.id) }
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
      me.passwordChangeRequired = false
      audit(me, 'ACCOUNT_CHANGED', { label: '비밀번호 변경' })
    },
    { internal: true },
  ),
  route(
    'POST',
    '/me/otp',
    ({ me, body }) => {
      if (me.otpEnrolled) throw new HttpError(409, 'INVALID_STATE', '이미 OTP를 등록했습니다')
      if (!body?.otpCode) {
        me.otpSecret = DEMO_OTP_SECRET
        return {
          secret: DEMO_OTP_SECRET,
          otpauthUri: `otpauth://totp/BeforeAI:${me.employeeNumber}?secret=${DEMO_OTP_SECRET}&issuer=BeforeAI`,
          verified: false,
        }
      }
      if (!me.otpSecret) throw new HttpError(409, 'INVALID_STATE', '먼저 OTP 비밀키를 발급받아야 합니다')
      if (body.otpCode !== DEMO_OTP) throw new HttpError(400, 'VALIDATION_ERROR', 'OTP 코드가 올바르지 않습니다')
      me.otpEnrolled = true
      audit(me, 'ACCOUNT_CHANGED', { label: 'OTP 등록' })
      return { verified: true }
    },
    { internal: true },
  ),
  route(
    'POST',
    '/me/signing-keys',
    ({ me, body }) => {
      const database = db()
      if (body.algorithm !== 'Ed25519') throw new HttpError(400, 'VALIDATION_ERROR', '지원하지 않는 알고리즘입니다')
      assertEd25519PublicKey(body.publicKey)
      if (database.signingKeys.some((k) => k.userId === me.id && k.status !== 'REVOKED')) {
        throw new HttpError(400, 'VALIDATION_ERROR', '이미 등록했거나 등록 대기 중인 공개키가 있습니다')
      }
      if (database.signingKeys.some((k) => k.publicKey === body.publicKey)) {
        throw new HttpError(400, 'VALIDATION_ERROR', '이미 제출된 공개키입니다')
      }
      const key: AdminSigningKey = {
        id: nextId('k'),
        algorithm: body.algorithm,
        publicKey: body.publicKey,
        status: 'PENDING',
        createdAt: nowIso(),
        userId: me.id,
      }
      database.signingKeys.unshift(key)
      audit(me, 'KEY_SUBMITTED', { label: key.id })
      return ownKeyView(key)
    },
    { internal: true, status: 201 },
  ),
  route('GET', '/me/signing-keys', ({ me, query }) =>
    paginate(
      db().signingKeys.filter((k) => k.userId === me.id).map(ownKeyView),
      query,
    ),
  ),
  route('GET', '/webshell/public-key', () => WEBSHELL_PUBLIC_KEY, { internal: true }),
  route('GET', '/me/notification-settings', ({ me }) => db().notificationSettings[me.id]),
  route('PUT', '/me/notification-settings', ({ me, body }) => {
    db().notificationSettings[me.id] = body
    return body
  }),

  // ── 관리자: 계정·조직 ───────────────────────────────────
  route(
    'POST',
    '/admin/users',
    ({ me, body }) => {
      const database = db()
      if (!body.employeeNumber || !body.name) throw new HttpError(400, 'VALIDATION_ERROR', '사번과 이름을 입력해 주세요')
      if (database.users.some((u) => u.employeeNumber === body.employeeNumber)) {
        throw new HttpError(409, 'INVALID_STATE', '이미 사용 중인 사번입니다')
      }
      const user: StoredUser = {
        id: nextId('u'),
        employeeNumber: body.employeeNumber,
        name: body.name,
        role: body.role,
        departmentId: body.departmentId ?? null,
        active: true,
        passwordChangeRequired: true,
        password: INITIAL_PASSWORD,
        otpEnrolled: false,
        otpSecret: null,
      }
      database.users.push(user)
      database.notificationSettings[user.id] = {
        slackUserId: null,
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
      // 서버와 같이 null은 바꾸지 않는다. 그래서 부서를 비울 수 없다.
      user.role = body.role ?? user.role
      user.departmentId = body.departmentId ?? user.departmentId
      user.active = body.active ?? user.active
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
      user.passwordChangeRequired = true
      audit(me, 'ACCOUNT_CHANGED', { label: `비밀번호 초기화 ${user.name}` })
      return { userId: user.id, initialPassword: INITIAL_PASSWORD }
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
  route(
    'GET',
    '/admin/policy',
    () => {
      const { policy, matrix } = db()
      const hash = bytesToHex(sha256(new TextEncoder().encode(canonicalize({ ...policy, approvalMatrix: matrix }))))
      return { ...policy, approvalMatrix: matrix, policyHash: `sha256:${hash}` }
    },
    { internal: true, roles: ['ADMIN'] },
  ),
  route(
    'PUT',
    '/admin/policy/preset',
    ({ me, body }) => {
      assertAdminProof(body.adminProof)
      const { policy, webshell } = db()
      policy.preset = body.preset
      webshell.policy.preset = body.preset
      audit(me, 'POLICY_CHANGED', { label: `규모 프리셋 ${body.preset}` })
      return { preset: policy.preset, policyVersion: nextPolicyVersion(), webshellApplied: true }
    },
    { internal: true, roles: ['ADMIN'] },
  ),
  route('GET', '/approval-matrix', () => ({ rules: db().matrix })),
  route(
    'PUT',
    '/admin/approval-matrix',
    ({ me, body }) => {
      assertAdminProof(body.adminProof)
      if (!body.rules?.length) throw new HttpError(400, 'VALIDATION_ERROR', '승인 기준표가 비어 있습니다')
      const database = db()
      database.matrix = body.rules
      database.webshell.policy.matrix = structuredClone(body.rules)
      audit(me, 'POLICY_CHANGED', { label: '승인 기준표 수정' })
      return { policyVersion: nextPolicyVersion(), webshellApplied: true, rules: database.matrix }
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
    ({ me, params, body }) => {
      const database = db()
      const proof = body?.adminProof
      if (!proof?.keyId || !proof.signature?.trim()) {
        throw new HttpError(400, 'VALIDATION_ERROR', '관리자 서명(adminProof)이 필요합니다')
      }
      const key = database.signingKeys.find((k) => k.id === params.keyId)
      if (!key) throw new HttpError(404, 'NOT_FOUND', '공개키를 찾을 수 없습니다')
      if (key.status !== 'PENDING') throw new HttpError(409, 'INVALID_STATE', '등록 대기 상태의 공개키만 등록할 수 있습니다')
      // 서명 키는 관리자 본인의 등록된 키여야 한다. 첫 관리자는 본인의 대기 키를 그 키 자신으로 서명해 등록한다.
      const proofKey = database.signingKeys.find((k) => k.id === proof.keyId)
      if (!proofKey || proofKey.userId !== me.id || (proofKey.status !== 'REGISTERED' && proofKey.id !== key.id)) {
        throw new HttpError(403, 'KEY_NOT_REGISTERED', '관리자 본인의 등록된 서명 키로 서명해야 합니다')
      }
      if (!signingService.verifyRegisterProof(proof.signature, key, proofKey.publicKey)) {
        throw new HttpError(403, 'FORBIDDEN_ROLE', '관리자 서명을 확인할 수 없습니다')
      }
      key.status = 'REGISTERED'
      database.webshell.policy.keys.push({ keyId: key.id, userId: key.userId, publicKey: key.publicKey })
      audit(me, 'KEY_REGISTERED', { label: `${requireUser(key.userId).name} ${key.id}` })
      return { keyId: key.id, status: key.status, policyVersion: database.policy.version }
    },
    { internal: true, roles: ['ADMIN'] },
  ),
  route(
    'DELETE',
    '/admin/signing-keys/:keyId',
    ({ me, params }) => {
      const database = db()
      const key = database.signingKeys.find((k) => k.id === params.keyId)
      if (!key) throw new HttpError(404, 'NOT_FOUND', '공개키를 찾을 수 없습니다')
      if (key.status === 'REVOKED') throw new HttpError(409, 'INVALID_STATE', '이미 폐기된 공개키입니다')
      key.status = 'REVOKED'
      database.webshell.policy.keys = database.webshell.policy.keys.filter((k) => k.keyId !== key.id)
      audit(me, 'KEY_REVOKED', { label: `${requireUser(key.userId).name} ${key.id}` })
    },
    { internal: true, roles: ['ADMIN'], status: 204 },
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
