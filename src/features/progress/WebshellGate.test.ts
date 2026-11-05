import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { gateView, isTreeClipped } from './progressStatus'
import { WebshellGate } from './WebshellGate'

const passed = gateView({ status: 'RUNNING', approvalRecordCount: 1 })
const render = (forbiddenExcluded?: number) => renderToStaticMarkup(createElement(WebshellGate, { gate: passed, lit: null, forbiddenExcluded }))

describe('금지 작업 관문 칸', () => {
  it('금지 작업을 뺐으면 실행 대상 기준임을 말한다', () => {
    expect(render(2)).toContain('통과 (금지 2개 제외)')
  })

  it('금지 작업이 없으면 예전 문구 그대로다. 변조 시연도 같다', () => {
    expect(render()).not.toContain('제외')
    expect(render(0)).not.toContain('제외')
  })

  it('판정은 바꾸지 않는다', () => {
    expect(render(2)).toContain('data-check="forbidden" data-check-state="passed"')
  })
})

describe('트리 잘림', () => {
  it('내용이 칸보다 넓을 때만 잘렸다고 본다', () => {
    expect(isTreeClipped({ scrollWidth: 1200, clientWidth: 800 })).toBe(true)
    expect(isTreeClipped({ scrollWidth: 800, clientWidth: 800 })).toBe(false)
    expect(isTreeClipped({ scrollWidth: 801, clientWidth: 800 })).toBe(false)
  })
})
