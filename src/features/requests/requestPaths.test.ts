import { describe, expect, it } from 'vitest'
import type { Plan, RequestDetail, Task, TaskApprovalStatus, TaskStatus } from '../../api/types'
import { allApprovalsCollected, approvalToShow } from './requestPaths'

function planWith(...statuses: TaskStatus[]): Plan {
  return { tasks: statuses.map((status) => ({ status }) as Task) } as Plan
}

const request = (currentPlan: Plan | null): Pick<RequestDetail, 'status' | 'currentPlan'> => ({ status: 'PENDING_APPROVAL', currentPlan })

describe('끝난 요청의 승인 현황', () => {
  const stamped: TaskApprovalStatus = {
    taskId: 't1',
    requirements: [{ rule: 'PROJECT_OWNER', count: 2, candidates: [], approvedBy: [{ userId: 'u1', name: '김담당', network: 'INTERNAL', at: 't', self: false }], satisfied: false }],
  }

  it('취소·거부된 요청의 PENDING 작업에는 승인 대기를 그리지 않는다', () => {
    expect(approvalToShow([stamped], { status: 'CANCELED' }, { id: 't1', status: 'PENDING' } as Task)).toBeUndefined()
    expect(approvalToShow([stamped], { status: 'REJECTED' }, { id: 't1', status: 'PENDING' } as Task)).toBeUndefined()
  })

  it('승인 대기 중이거나 이미 승인된 작업의 기록은 그대로 보여 준다', () => {
    expect(approvalToShow([stamped], { status: 'PENDING_APPROVAL' }, { id: 't1', status: 'PENDING' } as Task)).toBe(stamped)
    expect(approvalToShow([stamped], { status: 'CANCELED' }, { id: 't1', status: 'APPROVED' } as Task)).toBe(stamped)
  })
})

describe('승인이 다 모였는지 (API 명세 4.5)', () => {
  it('승인을 기다리는 작업이 있으면 모였다고 하지 않는다', () => {
    expect(allApprovalsCollected(request(planWith('APPROVED', 'PENDING')))).toBe(false)
  })

  it('승인된 작업이 하나도 없으면 모였다고 하지 않는다', () => {
    expect(allApprovalsCollected(request(planWith('REJECTED')))).toBe(false)
    expect(allApprovalsCollected(request(planWith('BLOCKED')))).toBe(false)
  })

  it('Plan이나 작업을 모르면 모였다고 하지 않는다', () => {
    expect(allApprovalsCollected(request(null))).toBe(false)
    expect(allApprovalsCollected(request(planWith()))).toBe(false)
  })

  it('모든 작업이 승인되었으면 모인 것이다', () => {
    expect(allApprovalsCollected(request(planWith('APPROVED', 'BLOCKED')))).toBe(true)
  })

  it('승인대기가 아니면 해당하지 않는다', () => {
    expect(allApprovalsCollected({ status: 'RUNNING', currentPlan: planWith('APPROVED') })).toBe(false)
  })
})
