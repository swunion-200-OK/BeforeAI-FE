import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setAccessToken, setTransport } from '../client'
import { adminApi, editorApi, forbiddenApi, orgApi, projectsApi } from '../endpoints'
import { devControls, initMock, mockFetch } from './index'
import { buildSeed } from './seed'
import { db, mockConfig } from './store'

/** 관리자·기획서·에디터 응답이 배포된 서버의 모양과 같은지 본다. 화면은 두 모드에서 같은 이름을 읽는다. */

class MemoryStorage {
  private map = new Map<string, string>()
  getItem = (key: string) => this.map.get(key) ?? null
  setItem = (key: string, value: string) => void this.map.set(key, value)
  removeItem = (key: string) => void this.map.delete(key)
}

const PROOF = { keyId: 'k-admin-a', signature: 'c2ln' }

function asUser(userId: string) {
  devControls.setNetwork('INTERNAL')
  setAccessToken(devControls.switchUser(userId))
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
  mockConfig.latencyMs = 0
  initMock()
  buildSeed()
  setTransport(mockFetch)
  asUser('u-admin')
})

describe('정책', () => {
  it('프리셋과 기준표는 서버의 이름으로 답하고 버전을 올린다', async () => {
    const before = (await adminApi.policy()).version
    const preset = await adminApi.applyPreset('MEDIUM', PROOF)
    expect(preset).toEqual({ preset: 'MEDIUM', policyVersion: before + 1, webshellApplied: true })

    const { rules } = await orgApi.approvalMatrix()
    const updated = await adminApi.updateMatrix(rules, PROOF)
    expect(updated).toEqual({ policyVersion: before + 2, webshellApplied: true, rules })

    const policy = await adminApi.policy()
    expect(policy.approvalMatrix).toEqual(rules)
    expect(policy.policyHash).toMatch(/^sha256:/)
    expect(Object.keys(policy)).not.toContain('slackNotifications')
  })

  it('기준표 한 줄은 유형, 위험도, 승인권자다', async () => {
    const { rules } = await orgApi.approvalMatrix()
    expect(rules[0]).toEqual({ taskType: 'DOC', risk: 'LOW', requiredApprovers: [{ rule: 'ANYONE', count: 1 }] })
  })

  it.each([undefined, { keyId: 'k' }, { keyId: 'k', signature: '  ' }])('서명이 없으면 서버처럼 400이다: %j', async (adminProof) => {
    await expect(adminApi.applyPreset('LARGE', adminProof as never)).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' })
    await expect(forbiddenApi.addRule({ departmentId: 'd-backend', taskType: 'DB', target: 'x', reason: 'y', adminProof: adminProof as never })).rejects.toMatchObject({ status: 400 })
  })

  it('비어 있는 기준표는 받지 않는다', async () => {
    await expect(adminApi.updateMatrix([], PROOF)).rejects.toMatchObject({ status: 400 })
  })
})

describe('금지 작업', () => {
  it('규칙은 CONFIRMED로 시작하고 응답에 서버에 없는 값이 없다', async () => {
    const { items } = await forbiddenApi.rules('d-backend')
    expect(items[0].status).toBe('CONFIRMED')
    expect(Object.keys(items[0]).sort()).toEqual(['departmentId', 'id', 'reason', 'status', 'target', 'taskType'])
  })

  it('제안 확정은 규칙과 정책 버전을 돌려준다', async () => {
    const before = (await adminApi.policy()).version
    const result = await forbiddenApi.confirm('fp-1', PROOF)
    expect(result).toMatchObject({ proposalId: 'fp-1', status: 'CONFIRMED', policyVersion: before + 1 })
    expect(result.rule.status).toBe('CONFIRMED')
    const [confirmed] = (await forbiddenApi.proposals('CONFIRMED')).items
    expect(Object.keys(confirmed).sort()).toEqual(['departmentId', 'id', 'reason', 'status', 'target', 'taskType'])
  })

  it('제안 반려와 해제 요청은 상태만 돌려준다', async () => {
    expect(await forbiddenApi.reject('fp-1', '사유')).toEqual({ proposalId: 'fp-1', status: 'REJECTED' })
    expect(await forbiddenApi.release('rule-1', { reason: '사유' })).toEqual({ ruleId: 'rule-1', status: 'RELEASE_PENDING' })
  })

  it('해제 요청에는 사유가 있어야 하고 두 번 할 수 없다', async () => {
    await expect(forbiddenApi.release('rule-1', { reason: ' ' })).rejects.toMatchObject({ status: 400 })
    await forbiddenApi.release('rule-1', { reason: '사유' })
    await expect(forbiddenApi.release('rule-1', { reason: '사유' })).rejects.toMatchObject({ status: 409, code: 'INVALID_STATE' })
  })

  it('서명 없는 해제 요청은 정책 버전을 올리지 않고, 서명이 있으면 올린다', async () => {
    const before = (await adminApi.policy()).version
    await forbiddenApi.release('rule-1', { reason: '사유' })
    expect((await adminApi.policy()).version).toBe(before)
    await forbiddenApi.release('rule-2', { reason: '사유', adminProof: PROOF })
    expect((await adminApi.policy()).version).toBe(before + 1)
  })
})

describe('프로젝트·기획서', () => {
  it('프로젝트 응답에 기준 커밋이 없고 담당자는 ID와 이름뿐이다', async () => {
    const project = await projectsApi.get('prj-auth')
    expect(Object.keys(project).sort()).toEqual(['departmentId', 'id', 'name', 'owners', 'repository'])
    expect(Object.keys(project.owners[0]).sort()).toEqual(['id', 'name'])
    expect(db().projects[0].baseCommit).toBeTruthy()
  })

  it('프로젝트를 만들 때 초기 기획서는 initialSpec.body로 받는다', async () => {
    const project = await adminApi.createProject({
      name: '새 프로젝트',
      departmentId: 'd-backend',
      repository: 'r',
      ownerIds: ['u-07', 'u-mgr-be'],
      initialSpec: { body: '# 초기' },
    })
    expect((await projectsApi.spec(project.id)).body).toBe('# 초기')
  })

  it('기획서는 저장한 사람의 ID를 주고, 복원이면 원본 버전을 알려 준다', async () => {
    const spec = await projectsApi.spec('prj-auth')
    expect(spec.createdBy).toBe('u-mgr-be')
    expect(spec.restoredFromVersion).toBeNull()
    expect(Object.keys(spec)).not.toContain('updatedBy')
    expect((await projectsApi.restoreSpec('prj-auth', 1)).restoredFromVersion).toBe(1)
  })

  it('수정 요청은 requesterId와 rejectionReason을 쓰고, 반영은 요청과 기획서를 함께 돌려준다', async () => {
    const { items } = await projectsApi.changeRequests('prj-auth')
    expect(items[0].requesterId).toBe('u-01')
    const accepted = await projectsApi.acceptChangeRequest('prj-auth', items[0].id)
    expect(accepted.changeRequest.status).toBe('ACCEPTED')
    expect(accepted.spec.body).toContain(items[0].content)

    const created = await projectsApi.createChangeRequest('prj-auth', { content: 'c', reason: 'r' })
    const rejected = await projectsApi.rejectChangeRequest('prj-auth', created.id, '안 됨')
    expect(rejected.rejectionReason).toBe('안 됨')
  })
})

describe('에디터', () => {
  it('파일 목록은 items와 대문자 type으로 답한다', async () => {
    const listing = await editorApi.files('prj-auth')
    expect(Object.keys(listing).sort()).toEqual(['baseCommit', 'items', 'path'])
    expect(new Set(listing.items.map((entry) => entry.type))).toEqual(new Set(['DIR', 'FILE']))
  })

  it('파일 내용에도 기준 커밋이 있다', async () => {
    const { items } = await editorApi.files('prj-auth')
    const file = items.find((entry) => entry.type === 'FILE')!
    const content = await editorApi.content('prj-auth', { path: file.path })
    expect(content.baseCommit).toBe((await editorApi.files('prj-auth')).baseCommit)
  })
})

describe('전사 일괄 중단', () => {
  it('status와 executionIds로 답한다', async () => {
    const result = await adminApi.killAll('전체 중단')
    expect(result.status).toBe('KILLED')
    expect(Array.isArray(result.executionIds)).toBe(true)
  })
})
