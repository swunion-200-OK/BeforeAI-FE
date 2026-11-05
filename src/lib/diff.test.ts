import { describe, expect, it } from 'vitest'
import { appendAddedLine, makeUnifiedDiff, parseUnifiedDiff, readUnifiedDiff } from './diff'

const lineRows = (diff: string) => parseUnifiedDiff(diff).flatMap((row) => (row.type === 'line' ? [row] : []))

describe('unified diff 읽기', () => {
  it('hunk 안의 --와 ++ 내용 줄을 머리글로 보지 않는다', () => {
    const diff = '--- a/q.sql\n+++ b/q.sql\n@@ -1,2 +1,2 @@\n--- 옛 주석\n+++ 새 주석\n 본문\n'
    const parsed = readUnifiedDiff(diff)
    expect(parsed.wellFormed).toBe(true)
    expect(parsed.files).toHaveLength(1)
    expect(parsed.files[0].hunks[0].lines).toEqual([
      { kind: 'removed', text: '-- 옛 주석' },
      { kind: 'added', text: '++ 새 주석' },
      { kind: 'context', text: '본문' },
    ])
  })

  it('hunk 줄 수가 끝나면 다음 파일 머리글을 읽는다', () => {
    const diff = '--- a/a\n+++ b/a\n@@ -1 +1 @@\n-x\n+y\n--- a/b\n+++ b/b\n@@ -1 +1 @@\n-p\n+q\n'
    const parsed = readUnifiedDiff(diff)
    expect(parsed.wellFormed).toBe(true)
    expect(parsed.files.map((file) => file.path)).toEqual(['a', 'b'])
  })

  it('줄 수가 모자라거나 남거나 diff가 아닌 줄이 있으면 형식 오류다', () => {
    expect(readUnifiedDiff('--- a/a\n+++ b/a\n@@ -1,2 +1,1 @@\n x\n').wellFormed).toBe(false)
    expect(readUnifiedDiff('--- a/a\n+++ b/a\n@@ -1,1 +1,1 @@\n x\n+넘치는 줄\n').wellFormed).toBe(false)
    expect(readUnifiedDiff('--- a/a\n+++ b/a\n@@ -1,1 +1,1 @@\nx\n').wellFormed).toBe(false)
    expect(readUnifiedDiff('아무 글').wellFormed).toBe(false)
    expect(readUnifiedDiff('--- a/a\n').wellFormed).toBe(false)
  })

  it('빈 문자열과 바뀐 줄 없는 머리글은 형식 오류가 아니다', () => {
    expect(readUnifiedDiff('')).toEqual({ wellFormed: true, files: [] })
    expect(readUnifiedDiff(makeUnifiedDiff('a.md', 'x\n', 'x\n')).wellFormed).toBe(true)
  })

  it('파일 끝 줄바꿈 표시와 git 머리글을 받아들인다', () => {
    expect(readUnifiedDiff(makeUnifiedDiff('a.md', 'x', 'y')).wellFormed).toBe(true)
    expect(readUnifiedDiff('diff --git a/a b/a\nindex 1..2 100644\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-x\n+y\n').wellFormed).toBe(true)
  })

  it('메타 줄만 있으면 그릴 내용이 없으니 형식 오류로 본다', () => {
    expect(readUnifiedDiff('diff --git a/a b/b\nsimilarity index 100%\nrename from a\nrename to b\n').wellFormed).toBe(false)
    expect(readUnifiedDiff('diff --git a/a.png b/a.png\nBinary files a/a.png and b/a.png differ\n').wellFormed).toBe(false)
    expect(readUnifiedDiff('diff --git a/a.png b/a.png\nBinary files differ\ndiff --git a/b b/b\n--- a/b\n+++ b/b\n@@ -1 +1 @@\n-x\n+y\n').wellFormed).toBe(false)
  })

  it('따옴표와 8진 이스케이프로 적힌 한글 경로를 푼다', () => {
    const diff = '--- "a/docs/\\355\\225\\234\\352\\270\\200.md"\n+++ "b/docs/\\355\\225\\234\\352\\270\\200.md"\n@@ -1 +1 @@\n-x\n+y\n'
    const parsed = readUnifiedDiff(diff)
    expect(parsed.wellFormed).toBe(true)
    expect(parsed.files[0]).toMatchObject({ oldPath: 'docs/한글.md', path: 'docs/한글.md' })
    expect(parseUnifiedDiff(diff)[0]).toEqual({ type: 'file', path: 'docs/한글.md' })
  })

  it('따옴표 안의 이스케이프와 이미 풀린 한글을 함께 읽는다', () => {
    expect(readUnifiedDiff('--- "a/x y\\t\\"z\\".md"\n+++ "b/한글 x.md"\n').files[0]).toMatchObject({ oldPath: 'x y\t"z".md', path: '한글 x.md' })
  })

  it('따옴표 없는 경로와 /dev/null은 그대로다', () => {
    expect(readUnifiedDiff('--- /dev/null\n+++ b/새 파일.md\n@@ -0,0 +1 @@\n+x\n').files[0]).toMatchObject({ oldPath: '/dev/null', path: '새 파일.md' })
  })

  it('추가 줄을 더해도 형식이 맞고 줄 번호가 이어진다', () => {
    const once = appendAddedLine('--- a/a\n+++ b/a\n@@ -1 +1 @@\n-x\n+y\n', '더한 줄')
    const twice = appendAddedLine(once, '또 더한 줄')
    expect(once).toContain('@@ -1 +1,2 @@')
    expect(twice).toContain('@@ -1 +1,3 @@')
    expect(readUnifiedDiff(twice).wellFormed).toBe(true)
    expect(lineRows(twice).at(-1)).toMatchObject({ right: { number: 3, text: '또 더한 줄', kind: 'added' } })
  })

  it('화면 행과 줄 번호가 그대로다', () => {
    const rows = lineRows('--- a/a\n+++ b/a\n@@ -3,2 +3,2 @@\n 같음\n-옛\n+새\n')
    expect(rows[0]).toMatchObject({ left: { number: 3, kind: 'context' }, right: { number: 3, kind: 'context' } })
    expect(rows[1]).toMatchObject({ left: { number: 4, text: '옛', kind: 'removed' }, right: { number: 4, text: '새', kind: 'added' } })
  })
})
