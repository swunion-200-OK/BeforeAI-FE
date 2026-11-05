import { describe, expect, it } from 'vitest'
import { withoutSlackOnServer } from './serverFeatures'

describe('서버에 없는 Slack 화면', () => {
  const tabs = [{ id: 'accounts' }, { id: 'slack' }]
  const isSlack = (tab: { id: string }) => tab.id === 'slack'

  it('실제 서버에서는 뺀다', () => {
    expect(withoutSlackOnServer(tabs, isSlack, false)).toEqual([{ id: 'accounts' }])
  })

  it('목 시연에서는 그대로 둔다', () => {
    expect(withoutSlackOnServer(tabs, isSlack, true)).toEqual(tabs)
  })
})
