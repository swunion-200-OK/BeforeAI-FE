import { describe, expect, it } from 'vitest'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { Plan, PlanHashTarget, Task } from '../api/types'
import { canonicalize, hashService, toHashTarget } from './hashService'

const REQUEST_ID = '3cc84fb8-bf15-50bf-ba57-a96cb27fc8b0'
const PLAN_ID = '3b8577ba-2c34-5587-8ef5-070e43948f6e'
const PROJECT_ID = 'f29db1e4-ac0e-5807-ab60-769dcdbe6a3c'
const CODE_TASK_ID = 'a7c3b121-6a1c-5ec1-a64b-592af1c08c0a'
const DEPLOY_TASK_ID = '261514d6-cf26-5489-a9a8-7cbc6bd60839'

function task(id: string, order: number, type: Task['type'], risk: Task['risk'], target: string, content: Task['content']): Task {
  return { id, order, type, risk, title: '작업', target, content, relatedDepartments: [], requiredApprovers: [], status: 'PENDING' }
}

/** 서버 PlanHashServiceTest의 Plan 그대로: 일부러 order 역순이고 금지 작업이 섞여 있다. */
const PLAN: Plan = {
  id: PLAN_ID,
  requestId: REQUEST_ID,
  kind: 'NORMAL',
  repository: 'git@internal:auth-service.git',
  baseCommit: '9b2f4e1',
  planHash: null,
  tasks: [
    task('11111111-1111-1111-1111-111111111111', 3, 'DB', 'FORBIDDEN', 'prod-db', { query: 'DROP TABLE users' }),
    task(DEPLOY_TASK_ID, 2, 'DEPLOY', 'HIGH', 'staging', { command: './deploy.sh staging' }),
    task(CODE_TASK_ID, 1, 'CODE_FEATURE', 'MEDIUM', 'src/auth/login.ts', { diff: '--- a/src/auth/login.ts\n+++ b/...' }),
  ],
}

/** 서버 PlanHashServiceTest.expectedCanonical을 그대로 옮겼다. 이 문자열이 달라지면 서명이 서버·웹쉘과 어긋난다. */
const SERVER_CANONICAL =
  `{"baseCommit":"9b2f4e1","planId":"${PLAN_ID}","projectId":"${PROJECT_ID}",` +
  `"repository":"git@internal:auth-service.git","requestId":"${REQUEST_ID}","tasks":[` +
  `{"content":{"diff":"--- a/src/auth/login.ts\\n+++ b/..."},"id":"${CODE_TASK_ID}","order":1,"risk":"MEDIUM","target":"src/auth/login.ts","type":"CODE_FEATURE"},` +
  `{"content":{"command":"./deploy.sh staging"},"id":"${DEPLOY_TASK_ID}","order":2,"risk":"HIGH","target":"staging","type":"DEPLOY"}` +
  `]}`

describe('서버 PlanHashService와 같은 바이트', () => {
  it('RFC 8785의 키 정렬 예시가 서버 테스트와 같다', () => {
    const value = { '\u20ac': 1, '\r': 2, '\ufb33': 3, '1': 4, '\ud83d\ude00': 5, '\u0080': 6, '\u00f6': 7 }
    expect(canonicalize(value)).toBe('{"\\r":2,"1":4,"\u0080":6,"\u00f6":7,"\u20ac":1,"\ud83d\ude00":5,"\ufb33":3}')
  })

  it('문자열 이스케이프가 서버 테스트와 같다: 제어 문자는 소문자 \\u, 한글은 그대로', () => {
    const value = { b: 10, a: '줄\n"따옴표"\\', c: [true, null, { z: 1, y: '\u0001\t' }] }
    expect(canonicalize(value)).toBe('{"a":"줄\\n\\"따옴표\\"\\\\","b":10,"c":[true,null,{"y":"\\u0001\\t","z":1}]}')
  })

  it('hashTarget은 금지 작업을 빼고 order 순이며, 정규화 결과가 서버 테스트의 문자열과 같다', () => {
    const target = toHashTarget(PLAN, PROJECT_ID)
    expect(target.tasks.map((item) => item.order)).toEqual([1, 2])
    expect(canonicalize(target)).toBe(SERVER_CANONICAL)
  })

  it('해시는 sha256: 뒤에 소문자 hex이고 정규화 문자열의 UTF-8 SHA-256이다', () => {
    const expected = `sha256:${bytesToHex(sha256(new TextEncoder().encode(SERVER_CANONICAL)))}`
    expect(hashService.computePlanHash(PLAN, PROJECT_ID)).toBe(expected)
    expect(expected).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('서버가 보낸 hashTarget을 키 순서와 상관없이 같은 해시로 계산한다', () => {
    const reordered = JSON.parse(SERVER_CANONICAL) as PlanHashTarget
    const shuffled = { tasks: reordered.tasks, requestId: reordered.requestId, baseCommit: reordered.baseCommit, planId: reordered.planId, repository: reordered.repository, projectId: reordered.projectId }
    expect(hashService.computeTargetHash(shuffled)).toBe(hashService.computePlanHash(PLAN, PROJECT_ID))
  })

  it('content의 null 필드는 해시 대상에서 빠지고, content가 없으면 빈 객체다 (PlanHashService.contentTarget)', () => {
    const withNulls = { ...PLAN, tasks: [task(CODE_TASK_ID, 1, 'CODE_MINOR', 'LOW', 'a', { diff: 'd', command: null, query: null, body: null } as unknown as Task['content'])] }
    expect(toHashTarget(withNulls, PROJECT_ID).tasks[0].content).toEqual({ diff: 'd' })
    const empty = { ...PLAN, tasks: [task(CODE_TASK_ID, 1, 'CODE_MINOR', 'LOW', 'a', null as unknown as Task['content'])] }
    expect(toHashTarget(empty, PROJECT_ID).tasks[0].content).toEqual({})
  })

  it('받은 hashTarget의 null은 지우지 않고 null로 계산한다. 서버 canonicalize가 그렇게 쓴다', () => {
    const target = JSON.parse(SERVER_CANONICAL) as PlanHashTarget
    const withNull = { ...target, baseCommit: null } as unknown as PlanHashTarget
    expect(canonicalize(withNull)).toContain('"baseCommit":null')
    expect(hashService.computeTargetHash(withNull)).not.toBe(hashService.computeTargetHash(target))
  })
})

describe('화면의 Plan과 hashTarget 비교', () => {
  const target = toHashTarget(PLAN, PROJECT_ID)

  it('금지 작업이 화면에 있어도, 순서가 달라도, content에 null이 있어도 같다고 본다', () => {
    expect(hashService.matchesHashTarget(PLAN, target)).toBe(true)
    const nulls = { ...PLAN, tasks: PLAN.tasks.map((item) => ({ ...item, content: { ...item.content, body: null } as unknown as Task['content'] })) }
    expect(hashService.matchesHashTarget(nulls, target)).toBe(true)
  })

  it.each([
    ['대상', { target: 'production' }],
    ['내용', { content: { command: './deploy.sh production' } }],
    ['위험도', { risk: 'MEDIUM' }],
    ['유형', { type: 'DB' }],
    ['순서', { order: 9 }],
  ] as Array<[string, Partial<Task>]>)('작업의 %s이 다르면 다르다고 본다', (_name, change) => {
    const shown = { ...PLAN, tasks: PLAN.tasks.map((item) => (item.id === DEPLOY_TASK_ID ? { ...item, ...change } : item)) }
    expect(hashService.matchesHashTarget(shown, target)).toBe(false)
  })

  it('금지 작업으로 표시해 서명 대상에서 빼려 해도 다르다고 본다', () => {
    const shown = { ...PLAN, tasks: PLAN.tasks.map((item) => (item.id === DEPLOY_TASK_ID ? { ...item, risk: 'FORBIDDEN' as const } : item)) }
    expect(hashService.matchesHashTarget(shown, target)).toBe(false)
  })

  it('화면에 없는 작업이 해시 대상에 있으면 다르다고 본다', () => {
    const shown = { ...PLAN, tasks: PLAN.tasks.filter((item) => item.id !== DEPLOY_TASK_ID) }
    expect(hashService.matchesHashTarget(shown, target)).toBe(false)
  })

  it('Plan ID, 요청, 저장소, 기준 커밋이 다르면 다르다고 본다', () => {
    expect(hashService.matchesHashTarget({ ...PLAN, id: 'other' }, target)).toBe(false)
    expect(hashService.matchesHashTarget({ ...PLAN, requestId: 'other' }, target)).toBe(false)
    expect(hashService.matchesHashTarget({ ...PLAN, repository: 'other' }, target)).toBe(false)
    expect(hashService.matchesHashTarget({ ...PLAN, baseCommit: 'other' }, target)).toBe(false)
  })
})
