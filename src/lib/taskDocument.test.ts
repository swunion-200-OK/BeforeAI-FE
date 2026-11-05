import { describe, expect, it } from 'vitest'
import { makeUnifiedDiff, parseUnifiedDiff } from './diff'
import { compareTaskDocument, compareWithCurrent, reconstructBaseLines, splitServerLines } from './taskDocument'

const PATH = 'docs/README.md'
const BODY = '첫 줄\n둘째 줄\n'
/** 서버 DocumentService.unifiedDiff가 만드는 모양 */
const SERVER_DIFF = `--- a/${PATH}\n+++ b/${PATH}\n@@ -1,1 +1,2 @@\n 첫 줄\n+둘째 줄\n`
const addedLines = (diff: string) => parseUnifiedDiff(diff).flatMap((row) => (row.type === 'line' && row.right?.kind === 'added' ? [row.right.text] : []))
const removedLines = (diff: string) => parseUnifiedDiff(diff).flatMap((row) => (row.type === 'line' && row.left?.kind === 'removed' ? [row.left.text] : []))

describe('문서 작업 비교', () => {
  it('서버 diff로 기준 문서만 구하고 비교는 서명할 본문으로 다시 만든다', () => {
    const compare = compareTaskDocument({ documentId: 'd1', body: BODY, diff: SERVER_DIFF }, BODY, PATH)
    expect(compare).toMatchObject({ kind: 'diff', isNew: false })
    if (compare.kind === 'diff') {
      expect(addedLines(compare.diff)).toEqual(['둘째 줄'])
      expect(compare.diff).toContain(`+++ b/${PATH}`)
    }
  })

  it('새 문서의 서버 머리글(-1,0)도 읽는다', () => {
    const diff = `--- a/${PATH}\n+++ b/${PATH}\n@@ -1,0 +1,2 @@\n+첫 줄\n+둘째 줄\n`
    const compare = compareTaskDocument({ documentId: null, body: BODY, diff }, BODY, PATH)
    expect(compare).toMatchObject({ kind: 'diff', isNew: true })
  })

  it('목의 diff 라이브러리 머리글(-0,0)도 읽는다', () => {
    const compare = compareTaskDocument({ documentId: null, body: BODY, diff: makeUnifiedDiff(PATH, '', BODY) }, BODY, PATH)
    expect(compare).toMatchObject({ kind: 'diff', isNew: true })
  })

  it('여러 hunk와 지운 줄을 역산한다', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'].join('\n') + '\n'
    const after = ['a', 'B', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'k', 'l', 'm'].join('\n') + '\n'
    const diff = makeUnifiedDiff(PATH, before, after)
    expect(reconstructBaseLines(diff, PATH, after)).toEqual(splitServerLines(before))
  })

  it('바뀐 줄이 없으면 비교가 없다고 한다', () => {
    expect(compareTaskDocument({ documentId: 'd1', body: 'x', diff: '' }, 'x', PATH)).toEqual({ kind: 'noChange' })
  })

  it('마지막 줄바꿈 차이는 서버처럼 바뀐 내용으로 치지 않는다', () => {
    expect(compareWithCurrent(PATH, '첫 줄\n둘째 줄', BODY)).toEqual({ kind: 'noChange' })
  })
})

describe('위조된 서버 비교', () => {
  const mismatch = { kind: 'mismatch' }
  const compare = (diff: string, documentId: string | null = 'd1') => compareTaskDocument({ documentId, body: BODY, diff }, BODY, PATH)

  it('본문이 서명할 본문과 다르면 쓰지 않는다', () => {
    expect(compareTaskDocument({ documentId: 'd1', body: '다른 본문', diff: SERVER_DIFF }, BODY, PATH)).toEqual(mismatch)
  })

  it('본문은 맞게 주고 diff에 없는 추가 줄을 넣으면 거부한다', () => {
    expect(compare(`--- a/${PATH}\n+++ b/${PATH}\n@@ -1,1 +1,2 @@\n 첫 줄\n+오타 수정만 했습니다\n`)).toEqual(mismatch)
  })

  it('문맥 줄을 바꿔도 거부한다', () => {
    expect(compare(`--- a/${PATH}\n+++ b/${PATH}\n@@ -1,1 +1,2 @@\n 무해한 줄\n+둘째 줄\n`)).toEqual(mismatch)
  })

  it('서명할 본문에 없는 지운 줄을 넣어도 화면의 추가 줄은 본문에서만 나온다', () => {
    const result = compare(`--- a/${PATH}\n+++ b/${PATH}\n@@ -1,2 +1,2 @@\n-위조한 이전 내용\n+첫 줄\n 둘째 줄\n`)
    expect(result).toMatchObject({ kind: 'diff' })
    if (result.kind === 'diff') {
      expect(addedLines(result.diff)).toEqual(['첫 줄'])
      expect(removedLines(result.diff)).toEqual(['위조한 이전 내용'])
    }
  })

  it('위치를 어긋나게 하면 거부한다', () => {
    expect(compare(`--- a/${PATH}\n+++ b/${PATH}\n@@ -5,1 +5,1 @@\n 둘째 줄\n`)).toEqual(mismatch)
    expect(compare(`--- a/${PATH}\n+++ b/${PATH}\n@@ -9,1 +2,1 @@\n 둘째 줄\n`)).toEqual(mismatch)
  })

  it('파일이 둘 이상이면 거부한다', () => {
    expect(compare(`${SERVER_DIFF}--- a/other.md\n+++ b/other.md\n@@ -1,1 +1,1 @@\n-x\n+y\n`)).toEqual(mismatch)
  })

  it('다른 파일의 diff면 거부한다', () => {
    expect(compare('--- a/other.md\n+++ b/other.md\n@@ -1,1 +1,2 @@\n 첫 줄\n+둘째 줄\n')).toEqual(mismatch)
  })

  it('형식이 틀리면 거부한다', () => {
    expect(compare('이건 diff가 아닙니다')).toEqual(mismatch)
    expect(compare(`--- a/${PATH}\n+++ b/${PATH}\n`)).toEqual(mismatch)
    expect(compare(`--- a/${PATH}\n+++ b/${PATH}\n@@ -1,1 +1,5 @@\n 첫 줄\n+둘째 줄\n`)).toEqual(mismatch)
  })

  it('새 문서인데 본문이 있고 비교가 비어 있으면 거부한다', () => {
    expect(compareTaskDocument({ documentId: null, body: BODY, diff: '' }, BODY, PATH)).toEqual(mismatch)
    expect(compareTaskDocument({ documentId: null, body: '', diff: '' }, '', PATH)).toEqual({ kind: 'noChange' })
  })

  it('새 문서라면서 지운 줄이 있으면 거부한다', () => {
    expect(compare(`--- a/${PATH}\n+++ b/${PATH}\n@@ -1,2 +1,2 @@\n-위조\n+첫 줄\n 둘째 줄\n`, null)).toEqual(mismatch)
  })
})

describe('큰 문서', () => {
  it('줄이 많아도 인자 수 한도로 깨지지 않는다', () => {
    const lines = Array.from({ length: 300_000 }, (_, index) => `줄 ${index}`)
    const body = `${lines.join('\n')}\n`
    const diff = `--- a/${PATH}\n+++ b/${PATH}\n@@ -150001,1 +150001,1 @@\n-옛 줄\n+${lines[150_000]}\n`
    const base = reconstructBaseLines(diff, PATH, body)
    expect(base).toHaveLength(300_000)
    expect(base?.[150_000]).toBe('옛 줄')
    expect(base?.[299_999]).toBe(lines[299_999])
  })
})

describe('서버 String.lines()와 같은 줄 나누기', () => {
  it.each([
    ['', []],
    ['\n', ['']],
    ['a', ['a']],
    ['a\n', ['a']],
    ['a\n\nb\n', ['a', '', 'b']],
    ['a\r\nb\rc', ['a', 'b', 'c']],
  ])('%j', (text, lines) => {
    expect(splitServerLines(text)).toEqual(lines)
  })

  it('줄바꿈 종류가 달라도 같은 줄이면 역산된다', () => {
    const body = '첫 줄\r\n둘째 줄\r\n'
    expect(compareTaskDocument({ documentId: 'd1', body, diff: SERVER_DIFF }, body, PATH)).toMatchObject({ kind: 'diff' })
  })
})

describe('롤백 Plan 비교', () => {
  it('서버 diff가 비어도 현재 문서와 되돌릴 내용을 비교한다', () => {
    const v1 = '첫 줄\n'
    const v2 = '첫 줄\n둘째 줄\n'
    const compare = compareWithCurrent(PATH, v2, v1)
    expect(compare).toMatchObject({ kind: 'diff', isNew: false })
    if (compare.kind === 'diff') expect(removedLines(compare.diff)).toEqual(['둘째 줄'])
  })

  it('현재 문서와 같으면 달라진 줄이 없다', () => {
    expect(compareWithCurrent(PATH, 'x\n', 'x\n')).toEqual({ kind: 'noChange' })
  })
})
