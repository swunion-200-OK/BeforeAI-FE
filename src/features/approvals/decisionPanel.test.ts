import { describe, expect, it } from 'vitest'
import { closedDecisionText, isDecisionClosed } from './decisionPanel'

describe('결정 칸', () => {
  it('승인 대기일 때만 결정 버튼을 내놓는다', () => {
    expect(isDecisionClosed('PENDING_APPROVAL')).toBe(false)
    expect(isDecisionClosed('REJECTED')).toBe(true)
    expect(isDecisionClosed('RUNNING')).toBe(true)
  })

  it('문서 미적용 뒤에는 끝난 상태를 말한다', () => {
    expect(closedDecisionText('REJECTED', [{ type: 'DOC' }])).toBe('미적용으로 처리했습니다')
    expect(closedDecisionText('REJECTED', [{ type: 'DOC' }, { type: 'DEPLOY' }])).toBe('거부된 요청입니다')
    expect(closedDecisionText('CANCELED', [{ type: 'DOC' }])).toBe('취소 상태라 더 결정할 것이 없습니다')
  })
})
