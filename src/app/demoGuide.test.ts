import { describe, expect, it } from 'vitest'
import { DEMO_SCENARIOS } from './demoGuide'

const externalSteps = DEMO_SCENARIOS.flatMap((group) => group.steps).filter((step) => step.network === 'EXTERNAL')

describe('시연 가이드의 외부망 설명', () => {
  it('외부망에서 일부 작업은 승인된다고 말하지 않는다. 승인 API는 전부 내부망 전용이다', () => {
    expect(externalSteps.length).toBeGreaterThan(0)
    for (const { label } of externalSteps) {
      expect(label).not.toContain('작업만 승인')
      expect(label).not.toContain('배포 작업이 막혀')
    }
  })
})
