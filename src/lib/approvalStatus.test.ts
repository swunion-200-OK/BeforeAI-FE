// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { Plan, ProgressRequestNode, RequestApproval, Task } from '../api/types'
import { approverNamesFromTree, deriveApprovalStatuses } from './approvalStatus'

const task = (id: string, requiredApprovers: Task['requiredApprovers'], extra: Partial<Task> = {}): Task => ({
  id,
  order: 1,
  type: 'DEPLOY',
  risk: 'HIGH',
  title: id,
  target: 'staging',
  content: {},
  relatedDepartments: [],
  requiredApprovers,
  status: 'PENDING',
  ...extra,
})
const plan = (...tasks: Task[]): Plan => ({ id: 'plan-1', requestId: 'r', kind: 'NORMAL', repository: 'repo', baseCommit: 'abc', planHash: 'sha256:1', tasks })
const signed = (approverId: string, taskIds: string[], id = approverId, planId = 'plan-1'): RequestApproval => ({ id, planId, approverId, taskIds, network: 'INTERNAL', createdAt: '2026-11-05T01:00:00Z' })
const requester = { id: 'u-req', name: '요청자', departmentId: null }
const names = new Map([['u-1', '김담당'], ['u-2', '이담당']])
const nameOf = (id: string) => names.get(id)
const statusOf = (currentPlan: Plan | null, approvals: RequestApproval[] = []) => deriveApprovalStatuses({ currentPlan, approvals, requester }, nameOf)

describe('승인 현황 계산', () => {
  it('Plan이 없으면 비어 있고, 금지 작업은 승인 대상이 아니다', () => {
    expect(statusOf(null)).toEqual([])
    expect(statusOf(plan(task('t1', [], { risk: 'FORBIDDEN' }), task('t2', [], { status: 'BLOCKED' })))).toEqual([])
  })

  it('기록이 없으면 충족으로 보지 않는다', () => {
    const [status] = statusOf(plan(task('t1', [{ rule: 'ANYONE', count: 1 }])))
    expect(status.requirements[0]).toMatchObject({ satisfied: false, approvedBy: [] })
  })

  it('승인 기록을 규칙 칸에 채우고, 다른 Plan의 기록은 세지 않는다', () => {
    const tasks = plan(task('t1', [{ rule: 'PROJECT_OWNER', count: 1, candidates: ['u-1', 'u-2'] }]))
    expect(statusOf(tasks, [signed('u-1', ['t1'], 'a', 'plan-old')])[0].requirements[0].satisfied).toBe(false)
    const [status] = statusOf(tasks, [signed('u-1', ['t1'])])
    expect(status.requirements[0]).toMatchObject({ satisfied: true, approvedBy: [{ userId: 'u-1', name: '김담당', self: false }] })
  })

  it('후보 목록이 맞는 규칙부터 채운다. 담당자와 부서 관리자 칸이 섞이지 않는다', () => {
    const tasks = plan(
      task('t1', [
        { rule: 'PROJECT_OWNER', count: 1, candidates: ['u-1'] },
        { rule: 'DEPT_MANAGER', count: 1, candidates: ['u-mgr'] },
      ]),
    )
    const [status] = statusOf(tasks, [signed('u-mgr', ['t1'])])
    expect(status.requirements[0].satisfied).toBe(false)
    expect(status.requirements[1].approvedBy[0].userId).toBe('u-mgr')
  })

  it('같은 사람이 두 번 제출해도 한 명으로 센다 (서버 ApprovalPolicy.satisfied)', () => {
    const tasks = plan(task('t1', [{ rule: 'ANYONE', count: 2 }]))
    const [status] = statusOf(tasks, [signed('u-1', ['t1'], 'a'), signed('u-1', ['t1'], 'b')])
    expect(status.requirements[0].approvedBy).toHaveLength(1)
    expect(status.requirements[0].satisfied).toBe(false)
  })

  it('이름을 모르는 승인자는 이름을 지어내지 않고, 요청자 본인은 본인 승인으로 표시한다', () => {
    const tasks = plan(task('t1', [{ rule: 'ANYONE', count: 1 }]))
    expect(statusOf(tasks, [signed('u-x', ['t1'])])[0].requirements[0].approvedBy[0].name).toBe('승인자')
    expect(statusOf(tasks, [signed('u-req', ['t1'])])[0].requirements[0].approvedBy[0].self).toBe(true)
  })

  it('후보 중 일부만 이름을 알면 그 사람만 기다리는 것처럼 쓰지 않는다', () => {
    const some = plan(task('t1', [{ rule: 'DEPT_MANAGER', count: 1, candidates: ['u-1', 'u-unknown'] }]))
    expect(statusOf(some)[0].requirements[0].candidates).toEqual([])
    const all = plan(task('t1', [{ rule: 'PROJECT_OWNER', count: 1, candidates: ['u-1', 'u-2'] }]))
    expect(statusOf(all)[0].requirements[0].candidates.map((item) => item.name)).toEqual(['김담당', '이담당'])
  })
})

describe('트리에서 승인자 이름 찾기', () => {
  it('승인 노드의 ID로 승인 기록과 맞춰 이름을 얻는다', () => {
    const root: ProgressRequestNode = {
      id: 'request:r',
      type: 'REQUEST',
      label: '요청',
      status: 'PENDING_APPROVAL',
      children: [
        {
          id: 'plan:1',
          type: 'PLAN',
          label: 'Plan v1',
          status: 'CURRENT',
          children: [
            {
              id: 'task:t1',
              type: 'TASK',
              label: '1. 배포',
              taskType: 'DEPLOY',
              risk: 'HIGH',
              status: 'PENDING',
              dependsOn: [],
              children: [
                { id: 'task:t1/approval:a1', type: 'APPROVAL', label: '김담당', status: 'APPROVED' },
                { id: 'task:t1/approval:pending:t1:0', type: 'APPROVAL', status: 'PENDING', candidates: ['u-9'] },
              ],
            },
          ],
        },
      ],
    }
    expect(approverNamesFromTree(root, [signed('u-1', ['t1'], 'a1')])).toEqual(new Map([['u-1', '김담당']]))
  })
})
