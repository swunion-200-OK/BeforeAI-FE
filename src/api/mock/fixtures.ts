import type { ApprovalMatrixRule, ApproverRule, Risk, TaskType } from '../types'

export const AUTH_REPOSITORY = 'git@internal:auth-service.git'
export const AUTH_BASE_COMMIT = '9b2f4e1'

export const AUTH_FILES: Record<string, string> = {
  'package.json': `{
  "name": "auth-service",
  "version": "2.4.0",
  "scripts": {
    "test": "vitest run",
    "start": "node dist/index.js"
  }
}
`,
  'src/index.ts': `import { createServer } from './server'
import { loginRoute } from './auth/login'

const app = createServer()
app.post('/login', loginRoute)
app.listen(Number(process.env.PORT ?? 8080))
`,
  'src/server.ts': `import express from 'express'

export function createServer() {
  const app = express()
  app.use(express.json())
  return app
}
`,
  'src/auth/login.ts': `import { findUser, verifyPassword } from './users'
import { issueSession } from './session'

export async function loginRoute(req, res) {
  const user = await findUser(req.body.employeeNo)
  if (!user || !(await verifyPassword(user, req.body.password))) {
    return res.status(401).json({ message: 'Invalid credentials' })
  }
  return res.json(await issueSession(user))
}
`,
  'src/auth/session.ts': `const SESSION_TTL_SECONDS = 60 * 15

export async function issueSession(user) {
  return {
    userId: user.id,
    expiresIn: SESSION_TTL_SECONDS,
  }
}
`,
  'src/auth/token.ts': `import { createHmac } from 'node:crypto'

export function signToken(payload, secret) {
  return createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex')
}
`,
  'src/auth/users.ts': `export async function findUser(employeeNo) {
  return db.users.findUnique({ where: { employeeNo } })
}

export async function verifyPassword(user, password) {
  return argon2.verify(user.passwordHash, password)
}
`,
  'tests/login.test.ts': `import { describe, expect, it } from 'vitest'
import { loginRoute } from '../src/auth/login'

describe('loginRoute', () => {
  it('rejects a wrong password', async () => {
    expect(loginRoute).toBeDefined()
  })
})
`,
  'docs/README.md': `# auth-service

사내 서비스의 로그인과 세션을 맡습니다.

## 실행

npm install 후 npm start로 띄웁니다.
`,
  'docs/api-guide.md': `# 인증 API 가이드

POST /login 으로 사번과 비밀번호를 보내면 세션을 돌려줍니다.
`,
}

export const DEPLOY_FILES: Record<string, string> = {
  'deploy.sh': `#!/usr/bin/env bash
set -euo pipefail
kubectl rollout restart "deployment/$1"
`,
  'README.md': `# deploy-pipeline

전사 배포 스크립트 모음입니다.
`,
}

export const AUTH_SPEC_V1 = `# auth-service 기획서

사내 서비스의 로그인과 세션을 맡는 프로젝트입니다.

## 범위

- 사번·비밀번호 로그인
- 세션 발급과 만료 관리
`

export const AUTH_SPEC_V2 = `${AUTH_SPEC_V1}
## 운영 원칙

- 스테이징 배포 후 담당자가 확인합니다.
- 운영 DB 스키마는 직접 바꾸지 않습니다.
`

export const DEPLOY_SPEC = `# deploy-pipeline 기획서

전사 서비스를 스테이징과 운영에 배포하는 스크립트를 관리합니다.
`

const matrixRule = (taskType: TaskType, risk: Risk, rule: ApproverRule): ApprovalMatrixRule => ({
  taskType,
  risk,
  requiredApprovers: [{ rule, count: 1 }],
})

export const DEFAULT_MATRIX: ApprovalMatrixRule[] = [
  matrixRule('DOC', 'LOW', 'ANYONE'),
  matrixRule('CODE_MINOR', 'LOW', 'ANYONE'),
  matrixRule('CODE_FEATURE', 'MEDIUM', 'ANYONE'),
  matrixRule('DATA_READ', 'MEDIUM', 'ANYONE'),
  matrixRule('DATA_WRITE', 'HIGH', 'PROJECT_OWNER'),
  matrixRule('DB', 'HIGH', 'PROJECT_OWNER'),
  matrixRule('DEPLOY', 'HIGH', 'PROJECT_OWNER'),
]
