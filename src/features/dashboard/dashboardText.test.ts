import { describe, expect, it } from 'vitest'
import { ATTENTION_STATUSES } from './statusGroups'
import { STATUS_GROUPS } from '../requests/requestPaths'
import { dashboardHeadline } from './dashboardText'

const base = { myPending: 0, external: false, attentionTotal: 0, scopeName: '회사 전체' }

describe('대시보드 첫 문장', () => {
  it('외부망에서는 승인할 수 있다고 하지 않고 내부망에서 할 수 있다고 한다', () => {
    expect(dashboardHeadline({ ...base, myPending: 3, external: true })).toBe('내부망에서 승인할 수 있는 요청 3건이 있습니다.')
  })

  it('내부망에서는 그대로다', () => {
    expect(dashboardHeadline({ ...base, myPending: 3 })).toBe('승인할 요청 3건이 있습니다.')
  })

  it('승인할 것이 없으면 확인 필요와 현황 순서로 말한다', () => {
    expect(dashboardHeadline({ ...base, attentionTotal: 2, external: true })).toBe('확인이 필요한 요청 2건이 있습니다.')
    expect(dashboardHeadline(base)).toBe('회사 전체 현황입니다.')
  })
})

describe('상태 묶음', () => {
  const attention = STATUS_GROUPS.find((group) => group.id === 'attention')?.statuses

  it('대시보드 확인 필요와 목록 탭이 같은 묶음이다', () => {
    expect(ATTENTION_STATUSES).toBe(attention)
    expect(ATTENTION_STATUSES).toContain('REAPPROVAL_REQUIRED')
  })

  it('한 상태는 한 묶음에만 있고 빠진 상태가 없다', () => {
    const all = STATUS_GROUPS.flatMap((group) => group.statuses)
    expect(new Set(all).size).toBe(all.length)
    expect(all.sort()).toEqual([
      'ANALYSIS_FAILED', 'ANALYZING', 'CANCELED', 'COMPLETED', 'FAILED', 'KILLED', 'PARTIALLY_COMPLETED', 'PENDING_APPROVAL',
      'REAPPROVAL_REQUIRED', 'REJECTED', 'REVIEWING', 'ROLLBACK_FAILED', 'ROLLED_BACK', 'ROLLING_BACK', 'RUNNING', 'VERIFICATION_FAILED',
    ])
  })
})
