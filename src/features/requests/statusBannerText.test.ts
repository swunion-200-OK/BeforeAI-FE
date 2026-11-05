import { describe, expect, it } from 'vitest'
import { allApprovedNowText, executionDeferredBanner, executionDeferredText, rollbackFailedText, verificationFailedTitle } from './statusBannerText'

describe('서명은 저장됐지만 실행을 시작하지 못한 경우', () => {
  it('실서버에서는 서명 저장과 실행 실패를 나눠 말하고, 다시 시도한다고 하지 않는다', () => {
    const { title, body } = executionDeferredBanner(false)
    expect(title).toContain('서명은 저장')
    expect(title).toContain('실행하지 못했습니다')
    expect(body).toContain('다시 시도하지 않으니')
    expect(executionDeferredText(false)).toContain('실행하지 못했습니다')
    expect(executionDeferredText(false)).not.toContain('다시 시도')
    expect(allApprovedNowText(false)).not.toContain('요청하는 중')
  })

  it('목은 실제로 다시 시도하므로 문구가 그대로다', () => {
    expect(executionDeferredBanner(true).body).toContain('자동으로 다시 요청')
    expect(executionDeferredText(true)).toContain('다시 시도')
    expect(allApprovedNowText(true)).toContain('요청하는 중')
  })
})

describe('실제 서버가 보내지 않는 경보', () => {
  it('실서버에서는 경보를 보냈다고 말하지 않는다', () => {
    expect(verificationFailedTitle(false)).not.toContain('경보')
    expect(rollbackFailedText(false)).not.toContain('경보')
    expect(rollbackFailedText(false)).toContain('다시 롤백')
  })

  it('목 시연 문구는 그대로다', () => {
    expect(verificationFailedTitle(true)).toContain('경보')
    expect(rollbackFailedText(true)).toContain('경보')
  })
})
