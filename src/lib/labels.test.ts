import { describe, expect, it } from 'vitest'
import type { RequestStatus } from '../api/types'
import { REQUEST_STATUS_LABEL, forbiddenReasonText, labelOf } from './labels'

describe('서버 자유 문자열과 모르는 값', () => {
  it('표에 없는 상태는 빈칸 대신 그 값을 쓴다', () => {
    expect(labelOf(REQUEST_STATUS_LABEL, 'RUNNING')).toBe('실행중')
    expect(labelOf(REQUEST_STATUS_LABEL, 'NEW_STATUS' as RequestStatus)).toBe('NEW_STATUS')
  })
})

describe('금지 사유', () => {
  it('서버 작업에는 사유가 없어 유형과 대상으로 사실만 말한다', () => {
    expect(forbiddenReasonText({ type: 'DEPLOY', target: 'production' })).toBe('배포 대상 production이(가) 부서 금지 규칙에 걸렸습니다.')
  })

  it('목이 준 사유가 있으면 그것을 쓴다', () => {
    expect(forbiddenReasonText({ type: 'DB', target: 'prod', forbiddenReason: '운영 DB 금지' })).toBe('운영 DB 금지')
  })
})
