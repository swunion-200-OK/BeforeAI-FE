import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Task } from '../api/types'
import { ChangeDetails, ChangeStats } from './ChangeExplanation'

const render = (task: Task) =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(ChangeDetails, { task })))

/** 서버 TaskResponse 모양: 설명 필드가 없다 */
const serverTask = {
  id: 't1',
  order: 0,
  type: 'DOC',
  risk: 'LOW',
  title: 'README 수정',
  target: 'docs/README.md',
  content: { body: '본문' },
  relatedDepartments: [],
  requiredApprovers: [],
  status: 'PENDING',
} as Task

describe('변경 크기', () => {
  const stats = (diff: string) => renderToStaticMarkup(createElement(ChangeStats, { task: { ...serverTask, type: 'CODE_MINOR', content: { diff } } }))

  it('형식이 틀린 diff를 +0 −0으로 말하지 않는다', () => {
    const html = stats('--- a/a\n+++ b/a\n@@ -1,1 +1,1 @@\n a\n-b\n+c\n+d\n')
    expect(html).toContain('줄 수를 셀 수 없습니다')
    expect(html).not.toContain('+0')
    expect(html).not.toContain('파일')
  })

  it('정상 diff는 숫자를 보여 준다', () => {
    const html = stats('--- a/a\n+++ b/a\n@@ -1 +1,2 @@\n-b\n+c\n+d\n')
    expect(html).toContain('+2')
    expect(html).toContain('−1')
  })
})

describe('변경 설명', () => {
  it('바뀌는 곳 설명이 없으면 제목도 없고, 되돌리기 안내는 남는다', () => {
    const html = render(serverTask)
    expect(html).not.toContain('어디가 바뀌나요')
    expect(html).toContain('되돌릴 수 있나요')
  })

  it('설명이 있으면 제목과 내용을 보여 준다', () => {
    const html = render({ ...serverTask, explanation: { summary: '요약', changes: [{ where: '장애 대응 절차', what: '새 절을 추가합니다' }], impact: [], undo: '되돌릴 수 있습니다' } })
    expect(html).toContain('어디가 바뀌나요')
    expect(html).toContain('장애 대응 절차')
  })
})
