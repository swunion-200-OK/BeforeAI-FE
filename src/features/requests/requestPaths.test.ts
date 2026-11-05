import { describe, expect, it } from 'vitest'
import type { Plan, RequestDetail, Task, TaskStatus } from '../../api/types'
import { allApprovalsCollected } from './requestPaths'

function planWith(...statuses: TaskStatus[]): Plan {
  return { tasks: statuses.map((status) => ({ status }) as Task) } as Plan
}

const request = (currentPlan: Plan | null): Pick<RequestDetail, 'status' | 'currentPlan'> => ({ status: 'PENDING_APPROVAL', currentPlan })

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
