import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Task } from '../api/types'
import { TaskContentView } from './TaskCard'

const BODY = '첫 줄\n'
const UNVERIFIED = '비교의 기준 문서는 서명으로 확인되지 않습니다'

const docTask = (content: Task['content']) => ({ id: 't1', type: 'DOC', target: 'docs/a.md', content }) as Task

function render(task: Task, seed: Array<[unknown[], unknown]>, planKind?: 'NORMAL' | 'ROLLBACK') {
  const client = new QueryClient()
  for (const [key, value] of seed) client.setQueryData(key, value)
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(TaskContentView, { task, requestId: 'r1', planKind })))
}

const documentKey = (body: string) => ['task-document', 'r1', 't1', body]

describe('문서 작업 내용', () => {
  it('달라진 줄이 없을 때도 기준 문서가 확인되지 않았다고 말한다', () => {
    const html = render(docTask({ body: BODY }), [[documentKey(BODY), { documentId: 'd1', taskId: 't1', body: BODY, diff: '' }]])
    expect(html).toContain('달라진 줄이 없습니다')
    expect(html).toContain(UNVERIFIED)
    expect(html).toContain('첫 줄')
  })

  it('비교가 있으면 기준 미검증 문구와 전체 내용을 함께 보여 준다', () => {
    const diff = '--- a/docs/a.md\n+++ b/docs/a.md\n@@ -1,0 +1,1 @@\n+첫 줄\n'
    const html = render(docTask({ body: BODY }), [[documentKey(BODY), { documentId: 'd1', taskId: 't1', body: BODY, diff }]])
    expect(html).toContain(UNVERIFIED)
    expect(html).toContain('<table')
    expect(html).toContain('문서 전체 내용')
  })

  it('문서 작업의 다른 필드도 서명 대상이라 숨기지 않는다', () => {
    const content = { body: BODY, command: 'rm -rf /tmp/x', query: 'DROP TABLE users' }
    const diff = '--- a/docs/a.md\n+++ b/docs/a.md\n@@ -1,0 +1,1 @@\n+첫 줄\n'
    const html = render(docTask(content), [[documentKey(BODY), { documentId: 'd1', taskId: 't1', body: BODY, diff }]])
    expect(html).toContain('rm -rf /tmp/x')
    expect(html).toContain('DROP TABLE users')
    expect(html).toContain('<table')
  })

  it('비교를 받는 중에도 다른 필드는 보인다', () => {
    const html = render(docTask({ body: BODY, command: 'rm -rf /tmp/x' }), [])
    expect(html).toContain('rm -rf /tmp/x')
  })
})

describe('롤백 Plan의 문서 비교', () => {
  const seed: Array<[unknown[], unknown]> = [
    [documentKey(BODY), { documentId: 'd1', taskId: 't1', body: BODY, diff: '' }],
    [['request', 'r1'], { id: 'r1', projectId: 'p1', status: 'PENDING_APPROVAL' }],
    [['task-document-current', 'p1', 'd1'], { documentId: 'd1', version: 2, body: '첫 줄\n둘째 줄\n', createdAt: 't' }],
  ]

  it('서버 비교가 비어도 문서 목록의 현재 버전과 비교한다', () => {
    const html = render(docTask({ body: BODY }), seed, 'ROLLBACK')
    expect(html).toContain('현재 문서 v2')
    expect(html).toContain('둘째 줄')
    expect(html).not.toContain('달라진 줄이 없습니다')
  })

  it('일반 Plan은 서버 비교 기준을 쓴다', () => {
    expect(render(docTask({ body: BODY }), seed, 'NORMAL')).toContain('달라진 줄이 없습니다')
  })
})
