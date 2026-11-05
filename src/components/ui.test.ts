import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ReasonModal } from './ui'

// 접속 환경 저장소는 서버 렌더링을 지원하지 않는다. 버튼 문구만 보면 되므로 내부망으로 둔다.
vi.mock('../lib/queries', () => ({ useIsExternal: () => false }))

const render = (label: string) =>
  renderToStaticMarkup(createElement(ReasonModal, { open: true, title: '제목', label, confirmLabel: '확인', onConfirm: () => {}, onClose: () => {} }))

describe('사유 창', () => {
  it('받침에 맞는 조사로 안내한다', () => {
    expect(render('수정할 내용')).toContain('수정할 내용을 입력해 주세요')
    expect(render('사유')).toContain('사유를 입력해 주세요')
  })
})
