// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { ApproverRule, FailedCheck, Plan, ProgressRequestNode, ProgressTaskNode, RequestEvent, RequestStatus } from '../../api/types'
import { GATE_ID, gateView, pathIds, pendingRule, progressNow } from './progressStatus'

const at = '2026-11-05T01:00:00.000Z'
const event = (status: RequestStatus): RequestEvent => ({ status, at, by: null })
const gate = (status: RequestStatus, failedChecks: FailedCheck[] = [], events: RequestEvent[] = [], approvalRecordCount = 1) =>
  gateView({ status, failedChecks, events, approvalRecordCount })
const states = (view: ReturnType<typeof gateView>) => view.checks.map((check) => check.state)

function tree(status: RequestStatus, tasks: ProgressTaskNode[]): ProgressRequestNode {
  return {
    id: 'request:r',
    type: 'REQUEST',
    label: '요청',
    status,
    children: [{ id: 'plan:p', type: 'PLAN', label: 'Plan v1', status: 'CURRENT', children: tasks }],
  }
}

function task(id: string, status: ProgressTaskNode['status'], children: ProgressTaskNode['children'] = []): ProgressTaskNode {
  return { id: `task:${id}`, type: 'TASK', label: `1. ${id}`, taskType: 'DEPLOY', risk: 'HIGH', status, dependsOn: [], children }
}

const request = {
  failedChecks: [] as FailedCheck[],
  rejection: null,
  kill: null,
  events: [event('PENDING_APPROVAL')],
  analysisError: null,
  requester: { id: 'u', name: '홍길동', departmentId: null },
}

describe('웹쉘 검증 관문은 데이터가 말하는 만큼만 말한다', () => {
  it('승인 전에는 대기이고 통과라고 하지 않는다', () => {
    const view = gate('PENDING_APPROVAL')
    expect(view.phase).toBe('waiting')
    expect(new Set(states(view))).toEqual(new Set(['waiting']))
  })

  it('실행을 시작했으면 여섯 검사가 모두 통과다', () => {
    for (const status of ['RUNNING', 'COMPLETED', 'KILLED', 'PARTIALLY_COMPLETED'] as RequestStatus[]) {
      const view = gate(status, [], [event('RUNNING'), event(status)])
      expect(view.phase).toBe('passed')
      expect(states(view)).toEqual(Array(6).fill('passed'))
    }
  })

  it('실패: 첫 실패 앞은 통과, 실패 항목은 실패, 뒤의 검사는 말하지 않는다', () => {
    expect(states(gate('VERIFICATION_FAILED', ['PLAN_HASH_MISMATCH']))).toEqual(['passed', 'failed', 'none', 'none', 'none', 'none'])
    expect(states(gate('VERIFICATION_FAILED', ['PLAN_HASH_MISMATCH', 'MISSING_REQUIRED_APPROVER']))).toEqual([
      'passed',
      'failed',
      'none',
      'none',
      'failed',
      'none',
    ])
    expect(states(gate('VERIFICATION_FAILED', ['KEY_NOT_REGISTERED']))).toEqual(['passed', 'passed', 'failed', 'none', 'none', 'none'])
    expect(states(gate('VERIFICATION_FAILED', ['FORBIDDEN_TASK']))).toEqual(['passed', 'passed', 'passed', 'passed', 'passed', 'failed'])
  })

  it('실패 항목을 모르면 아무 검사도 통과라고 하지 않는다', () => {
    expect(states(gate('VERIFICATION_FAILED'))).toEqual(Array(6).fill('none'))
  })

  it('승인 기록이 없으면 서명 검사를 통과라고 하지 않는다 (위조 승인)', () => {
    expect(states(gate('VERIFICATION_FAILED', ['MISSING_REQUIRED_APPROVER'], [], 0))).toEqual(['none', 'none', 'none', 'none', 'failed', 'none'])
    expect(states(gate('VERIFICATION_FAILED', ['MISSING_REQUIRED_APPROVER'], [], 1))).toEqual(['passed', 'passed', 'passed', 'passed', 'failed', 'none'])
    expect(states(gate('RUNNING', [], [event('RUNNING')], 0))).toEqual(['none', 'none', 'none', 'none', 'passed', 'passed'])
  })

  it('실패 사유는 기존 문구로 쓴다', () => {
    expect(gate('VERIFICATION_FAILED', ['NONCE_ALREADY_USED']).failures).toEqual(['이미 실행에 쓴 서명'])
  })

  it('실행 없이 끝난 요청은 관문을 지나지 않았다', () => {
    expect(gate('REJECTED', [], [event('PENDING_APPROVAL'), event('REJECTED')]).phase).toBe('unreached')
    expect(gate('COMPLETED', [], [event('REVIEWING'), event('COMPLETED')]).phase).toBe('unreached')
    expect(gate('CANCELED').phase).toBe('unreached')
    expect(new Set(states(gate('CANCELED')))).toEqual(new Set(['none']))
  })
})

describe('명세에 없는 필드가 빠져도', () => {
  it('필드가 없어도 예외 없이 아무것도 통과라고 하지 않는다', () => {
    for (const status of ['COMPLETED', 'VERIFICATION_FAILED', 'KILLED', 'FAILED', 'RUNNING', 'REJECTED'] as RequestStatus[]) {
      const view = gateView({ status })
      expect(view.checks.slice(0, 4).every((check) => check.state === 'none')).toBe(true)
    }
    expect(gateView({ status: 'COMPLETED' }).phase).toBe('unknown')
    expect(gateView({ status: 'COMPLETED' }).checks.every((check) => check.state === 'none')).toBe(true)
  })

  it('승인 기록 수가 없으면 승인권자 실패 앞의 서명 검사를 통과라고 하지 않는다', () => {
    const view = gateView({ status: 'VERIFICATION_FAILED', failedChecks: ['MISSING_REQUIRED_APPROVER'] })
    expect(states(view)).toEqual(['none', 'none', 'none', 'none', 'failed', 'none'])
  })

  it('이후 Plan이 승인 단계로 돌아왔으면 지난 실행은 지금 Plan의 통과가 아니다', () => {
    const events = [event('RUNNING'), event('PARTIALLY_COMPLETED'), event('PENDING_APPROVAL'), event('REJECTED')]
    expect(gate('REJECTED', [], events).phase).toBe('unreached')
    const patched = [event('RUNNING'), event('PARTIALLY_COMPLETED'), event('ANALYZING'), event('REVIEWING'), event('COMPLETED')]
    expect(gate('COMPLETED', [], patched).phase).toBe('unreached')
  })

  const pendingNode = { id: 'approval:a', type: 'APPROVAL' as const, status: 'PENDING' as const }
  const textOf = (node: ProgressTaskNode['children'][number]) =>
    progressNow(tree('PENDING_APPROVAL', [task('스테이징 배포', 'PENDING', [node])]), undefined).text

  it('규칙도 후보도 모르면 누구나라고 하지 않는다', () => {
    expect(textOf(pendingNode)).toBe('스테이징 배포가 승인을 기다립니다')
  })

  const planOf = (rule: ApproverRule) => ({ tasks: [{ id: 't1', requiredApprovers: [{ rule, count: 1 }] }] }) as Pick<Plan, 'tasks'>
  const pendingOf = { ...pendingNode, id: 'task:스테이징 배포/approval:pending:t1:0' }
  const textWith = (rule: ApproverRule) =>
    progressNow(tree('PENDING_APPROVAL', [task('스테이징 배포', 'PENDING', [pendingOf])]), { currentPlan: planOf(rule) as Plan }).text

  it('후보는 ID로만 오므로 이름을 지어내지 않는다', () => {
    expect(textOf({ ...pendingNode, candidates: ['7e5a', '9f0d'] })).toBe('스테이징 배포가 승인을 기다립니다')
  })

  it('규칙은 대기 노드 ID의 순번으로 요청 상세의 requiredApprovers에서 찾는다', () => {
    expect(textWith('PROJECT_OWNER')).toBe('스테이징 배포가 프로젝트 담당자의 승인을 기다립니다')
    expect(pendingRule(pendingOf, planOf('DEPT_MANAGER'))).toBe('DEPT_MANAGER')
    expect(pendingRule({ ...pendingNode, id: 'approval:a1' }, planOf('DEPT_MANAGER'))).toBeUndefined()
  })

  it('누구나 규칙일 때만 누구나라고 한다', () => {
    expect(textWith('ANYONE')).toBe('스테이징 배포가 승인을 기다립니다 (누구나 승인 가능)')
  })

  it('승인 노드가 없는 대기 작업을 승인이 모였다고 하지 않는다', () => {
    const root = tree('PENDING_APPROVAL', [task('배포', 'PENDING')])
    expect(progressNow(root, undefined)).toMatchObject({ text: '승인을 기다립니다', leaves: ['task:배포'] })
  })

  it('요청 정보 없이 모든 상태의 문장을 만든다', () => {
    const statuses: RequestStatus[] = ['ANALYZING', 'ANALYSIS_FAILED', 'REVIEWING', 'PENDING_APPROVAL', 'REAPPROVAL_REQUIRED', 'VERIFICATION_FAILED', 'REJECTED', 'CANCELED', 'RUNNING', 'KILLED', 'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'ROLLING_BACK', 'ROLLED_BACK', 'ROLLBACK_FAILED']
    for (const status of statuses) {
      const now = progressNow(tree(status, [task('배포', 'PENDING')]), {})
      expect(now.text, status).not.toContain('undefined')
      expect(now.since).toBeUndefined()
    }
  })
})

describe('지금 문장과 경로', () => {
  const pending = { id: 'approval:pending:t1:0', type: 'APPROVAL' as const, status: 'PENDING' as const, candidates: ['u-07'] }
  const owner = { tasks: [{ id: 't1', requiredApprovers: [{ rule: 'PROJECT_OWNER', count: 1 }] }] } as Plan

  it('승인 대기: 작업과 규칙과 실제 시각을 쓴다', () => {
    const root = tree('PENDING_APPROVAL', [task('스테이징 배포', 'PENDING', [pending])])
    const now = progressNow(root, { ...request, currentPlan: owner })
    expect(now.text).toBe('스테이징 배포가 프로젝트 담당자의 승인을 기다립니다')
    expect(now.since).toBe(at)
    expect(now.mode).toBe('wait')
    expect([...pathIds(root, now.leaves)]).toEqual(['request:r', 'approval:pending:t1:0', 'plan:p', 'task:스테이징 배포'])
  })

  it('받침이 있으면 "이"를 쓰고, 시각이 없으면 경과 시간을 말하지 않는다', () => {
    const root = tree('PENDING_APPROVAL', [task('메시지 변경', 'PENDING', [pending])])
    const now = progressNow(root, { currentPlan: owner })
    expect(now.text).toBe('메시지 변경이 프로젝트 담당자의 승인을 기다립니다')
    expect(now.since).toBeUndefined()
  })

  it('여러 작업이 기다리면 경로도 여러 개다', () => {
    const root = tree('PENDING_APPROVAL', [
      task('가', 'PENDING', [{ ...pending, id: 'approval:1' }]),
      task('나', 'PENDING', [{ ...pending, id: 'approval:2' }]),
    ])
    const now = progressNow(root, request)
    expect(now.text).toBe('작업 2개가 승인을 기다립니다: 가, 나')
    expect(now.leaves).toEqual(['approval:1', 'approval:2'])
    const ids = pathIds(root, now.leaves)
    expect(ids.has('task:가') && ids.has('task:나')).toBe(true)
  })

  it('실행 중: 지금 단계를 말하고 관문을 지나 단계로 이어진다', () => {
    const step = { id: 'step:s', type: 'STEP' as const, label: './deploy.sh staging', status: 'RUNNING' as const }
    const root = tree('RUNNING', [task('스테이징 배포', 'RUNNING', [step]), task('다른 작업', 'APPROVED')])
    const now = progressNow(root, request)
    expect(now.text).toBe('스테이징 배포 실행 중: ./deploy.sh staging')
    expect(now.since).toBeUndefined()
    const ids = pathIds(root, now.leaves)
    expect(ids.has(GATE_ID)).toBe(true)
    expect(ids.has('task:다른 작업')).toBe(false)
    expect(progressNow(root, request, true).leaves).toEqual([GATE_ID])
  })

  it('검증 실패: 사유를 말하고 경로는 움직이지 않는다', () => {
    const root = tree('VERIFICATION_FAILED', [task('배포', 'APPROVED'), task('금지', 'BLOCKED')])
    const now = progressNow(root, { ...request, failedChecks: ['PLAN_HASH_MISMATCH'] })
    expect(now.text).toBe('웹쉘이 실행을 거부했습니다: Plan 해시 불일치')
    expect(now.mode).toBe('failed')
    const ids = pathIds(root, now.leaves)
    expect(ids.has('task:배포')).toBe(true)
    expect(ids.has('task:금지')).toBe(false)
  })

  it('분석이 1분을 넘기면 분석하고 있다고 말하지 않는다', () => {
    const root = tree('ANALYZING', [])
    expect(progressNow(root, { updatedAt: new Date().toISOString() }).text).toBe('AI가 요청을 분석하고 있습니다')
    const stuck = progressNow(root, { updatedAt: new Date(Date.now() - 61_000).toISOString() })
    expect(stuck.text).toBe('분석이 평소보다 오래 걸리고 있습니다')
    expect(stuck.since).toBeDefined()
  })

  it('끝난 요청에는 경로가 없다', () => {
    const now = progressNow(tree('COMPLETED', [task('배포', 'SUCCEEDED')]), request)
    expect(now).toMatchObject({ text: '작업 1개를 모두 끝냈습니다', leaves: [], mode: null })
    expect(pathIds(tree('COMPLETED', []), now.leaves).size).toBe(0)
  })
})
