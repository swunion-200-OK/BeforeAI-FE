import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DiffViewer } from './DiffViewer'

const render = (diff: string) => renderToStaticMarkup(createElement(DiffViewer, { diff }))

const NO_CHANGE = '바뀐 내용이 없습니다'
const RAW_LABEL = '형식을 읽지 못해 원문을 그대로 보여 줍니다'

describe('DiffViewer', () => {
  it.each([
    ['diff가 아닌 글', '이건 diff가 아닙니다'],
    ['hunk 줄 수가 모자람', '--- a/a.md\n+++ b/a.md\n@@ -1,1 +1,5 @@\n 첫 줄\n+둘째 줄\n'],
    ['hunk 줄 수를 넘는 추가 줄', '--- a/a.md\n+++ b/a.md\n@@ -1,1 +1,1 @@\n 첫 줄\n+넘치는 줄\n'],
    ['파일 머리글만 있고 짝이 없음', '--- a/a.md\n'],
  ])('형식이 틀리면 표 대신 원문을 보여 주고 바뀐 내용이 없다고 하지 않는다: %s', (_name, diff) => {
    const html = render(diff)
    expect(html).toContain(RAW_LABEL)
    expect(html).not.toContain(NO_CHANGE)
    expect(html).not.toContain('<table')
    // 원문의 각 줄이 그대로 보인다. 태그 안의 글자로 비교한다.
    for (const line of diff.split('\n').filter(Boolean)) expect(html).toContain(line)
  })

  it('정상 diff는 표로 보여 주고 원문 안내를 쓰지 않는다', () => {
    const html = render('--- a/a.md\n+++ b/a.md\n@@ -1,2 +1,2 @@\n 같은 줄\n-옛 줄\n+새 줄\n')
    expect(html).toContain('<table')
    expect(html).toContain('a.md')
    expect(html).toContain('같은 줄')
    expect(html).toContain('옛 줄')
    expect(html).toContain('새 줄')
    expect(html).not.toContain(RAW_LABEL)
    expect(html).not.toContain(NO_CHANGE)
  })

  it('hunk 안의 --와 ++ 내용 줄도 표의 내용으로 나온다', () => {
    const html = render('--- a/q.sql\n+++ b/q.sql\n@@ -1,1 +1,1 @@\n--- 옛 주석\n+++ 새 주석\n')
    expect(html).toContain('<table')
    expect(html).toContain('-- 옛 주석')
    expect(html).toContain('++ 새 주석')
    expect(html).not.toContain(RAW_LABEL)
  })

  it.each([
    ['빈 문자열', ''],
    ['바뀐 줄 없는 머리글', '--- a/a.md\n+++ b/a.md\n'],
  ])('정상이고 바뀐 줄이 없을 때만 바뀐 내용이 없다고 한다: %s', (_name, diff) => {
    const html = render(diff)
    expect(html).toContain(NO_CHANGE)
    expect(html).not.toContain('<table')
    expect(html).not.toContain(RAW_LABEL)
  })
})
