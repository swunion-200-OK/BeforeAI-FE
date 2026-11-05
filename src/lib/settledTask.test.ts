import { describe, expect, it } from 'vitest'
import type { ProgressRequestNode, RequestStatus } from '../api/types'
import { interruptedTaskIds, isInterruptedTask, settleProgressRoot, shownTaskStatus } from './settledTask'

const tree = (status: RequestStatus): ProgressRequestNode => ({
  id: 'request:r',
  type: 'REQUEST',
  label: '요청',
  status,
  children: [
    {
      id: 'plan:p',
      type: 'PLAN',
      label: 'Plan v1',
      status: 'CURRENT',
      children: [
        {
          id: 'task:1',
          type: 'TASK',
          label: '1. 작업',
          taskType: 'DOC',
          risk: 'LOW',
          status: 'PENDING',
          dependsOn: [],
          children: [
            { id: 'task:1/approval:a', type: 'APPROVAL', label: '김담당', status: 'APPROVED' },
            { id: 'approval:pending:1:0', type: 'APPROVAL', status: 'PENDING' },
          ],
        },
      ],
    },
  ],
})

describe('킬 스위치로 멈춘 작업', () => {
  const step = (status: 'RUNNING' | 'SKIPPED' | 'SUCCEEDED') => ({ id: `step:${status}`, type: 'STEP' as const, label: '단계', status })
  const task = (id: string, status: 'SKIPPED' | 'SUCCEEDED', children: ReturnType<typeof step>[]) => ({
    id: `task:${id}`,
    type: 'TASK' as const,
    label: id,
    taskType: 'DEPLOY' as const,
    risk: 'HIGH' as const,
    status,
    dependsOn: [],
    children,
  })
  const killed: ProgressRequestNode = {
    id: 'request:r',
    type: 'REQUEST',
    label: '요청',
    status: 'KILLED',
    children: [{ id: 'plan:p', type: 'PLAN', label: 'Plan v1', status: 'CURRENT', children: [task('done', 'SUCCEEDED', [step('SUCCEEDED')]), task('halfway', 'SKIPPED', [step('SKIPPED')]), task('later', 'SKIPPED', [])] }],
  }

  it('실행 단계가 있으면 멈춘 작업이고, 시작 전 작업은 그대로다', () => {
    expect(isInterruptedTask(task('halfway', 'SKIPPED', [step('SKIPPED')]))).toBe(true)
    expect(isInterruptedTask(task('later', 'SKIPPED', []))).toBe(false)
    expect(isInterruptedTask(task('done', 'SUCCEEDED', [step('SUCCEEDED')]))).toBe(false)
    expect([...interruptedTaskIds(killed)]).toEqual(['halfway'])
  })

  it('서버가 RUNNING으로 남긴 단계도 중단된 요청에서는 실행 중이 아니다', () => {
    const root = { ...killed, children: [{ id: 'plan:p', type: 'PLAN' as const, label: 'Plan v1', status: 'CURRENT' as const, children: [task('halfway', 'SKIPPED', [step('RUNNING')])] }] }
    const plan = settleProgressRoot(root).children[0] as { children: Array<{ children: Array<{ status: string }> }> }
    expect(plan.children[0].children[0].status).toBe('SKIPPED')
  })
})

describe('끝난 요청의 작업', () => {
  it.each<RequestStatus>(['CANCELED', 'REJECTED', 'KILLED', 'COMPLETED', 'FAILED', 'ROLLED_BACK'])('%s면 승인 대기로 보이지 않는다', (status) => {
    expect(shownTaskStatus('PENDING', status)).toBe('SKIPPED')
  })

  it.each<RequestStatus>(['PENDING_APPROVAL', 'REAPPROVAL_REQUIRED', 'VERIFICATION_FAILED', 'REVIEWING'])('%s면 그대로 둔다', (status) => {
    expect(shownTaskStatus('PENDING', status)).toBe('PENDING')
  })

  it('승인됨이나 금지처럼 이미 정해진 상태는 바꾸지 않는다', () => {
    expect(shownTaskStatus('APPROVED', 'CANCELED')).toBe('APPROVED')
    expect(shownTaskStatus('BLOCKED', 'CANCELED')).toBe('BLOCKED')
    expect(shownTaskStatus('PENDING', undefined)).toBe('PENDING')
  })

  it('트리에서는 승인 대기 노드를 치우고 받은 승인은 남긴다', () => {
    const plan = settleProgressRoot(tree('CANCELED')).children[0] as { children: Array<{ status: string; children: Array<{ id: string }> }> }
    expect(plan.children[0].status).toBe('SKIPPED')
    expect(plan.children[0].children.map((child) => child.id)).toEqual(['task:1/approval:a'])
  })

  it('진행 중인 요청의 트리는 그대로 돌려준다', () => {
    const root = tree('PENDING_APPROVAL')
    expect(settleProgressRoot(root)).toBe(root)
  })
})
