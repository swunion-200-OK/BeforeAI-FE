import type { TaskDocument } from '../api/types'
import { makeUnifiedDiff, readUnifiedDiff } from './diff'

export type DocumentCompare =
  /** diff는 서버 값이 아니라 해시로 검증한 본문으로 화면에서 만든 것이다 */
  | { kind: 'diff'; diff: string; isNew: boolean }
  | { kind: 'noChange' }
  /** 서버가 준 비교를 서명할 본문에 맞출 수 없다. 그 비교는 믿을 수 없다 */
  | { kind: 'mismatch' }

/** 서버의 Java String.lines()와 같게 나눈다: 줄바꿈은 \n, \r, \r\n이고, 마지막 줄바꿈 뒤에는 줄이 없다. */
export function splitServerLines(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/)
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** 큰 문서는 스프레드로 넘기면 인자 수 한도에 걸린다. */
function appendLines(to: string[], from: string[], start: number, end: number) {
  for (let index = start; index < end; index += 1) to.push(from[index])
}

const joinLines = (lines: string[]) => lines.map((line) => `${line}\n`).join('')

/**
 * 서버 diff의 hunk를 거꾸로 적용해 기준 문서의 줄을 구한다. 맞지 않으면 null이다.
 * 추가·문맥 줄이 서명할 본문과 한 글자라도 다르거나, 위치가 어긋나거나, 파일이 하나가 아니면 맞지 않는 것이다.
 */
export function reconstructBaseLines(diff: string, target: string, signedBody: string): string[] | null {
  const { wellFormed, files } = readUnifiedDiff(diff)
  if (!wellFormed || files.length !== 1) return null
  const [file] = files
  if (file.path !== target || file.oldPath !== target || file.hunks.length === 0) return null

  const signed = splitServerLines(signedBody)
  const base: string[] = []
  let position = 0
  for (const hunk of file.hunks) {
    // 줄 수가 0인 쪽의 시작 번호는 도구마다 다르다: 서버는 빈 문서를 1로, 이 화면의 diff 라이브러리는 0으로 쓴다.
    const newIndex = hunk.newCount > 0 ? hunk.newStart - 1 : signed.length === 0 ? 0 : hunk.newStart
    if (newIndex < position || newIndex > signed.length) return null
    appendLines(base, signed, position, newIndex)
    position = newIndex
    const oldMatches = hunk.oldCount > 0 ? hunk.oldStart - 1 === base.length : hunk.oldStart === base.length || (base.length === 0 && hunk.oldStart <= 1)
    if (!oldMatches) return null
    for (const { kind, text } of hunk.lines) {
      if (kind !== 'removed') {
        if (signed[position] !== text) return null
        position += 1
      }
      if (kind !== 'added') base.push(text)
    }
  }
  appendLines(base, signed, position, signed.length)
  return base
}

/** 기준 문서와 서명할 본문을 서버와 같은 줄 단위로 비교한다. 마지막 줄바꿈 차이는 바뀐 내용으로 치지 않는다. */
function compareLines(target: string, baseLines: string[], signedBody: string, isNew: boolean): DocumentCompare {
  const signedLines = splitServerLines(signedBody)
  const same = baseLines.length === signedLines.length && baseLines.every((line, index) => line === signedLines[index])
  if (same) return { kind: 'noChange' }
  return { kind: 'diff', diff: makeUnifiedDiff(target, joinLines(baseLines), joinLines(signedLines)), isNew }
}

/**
 * 서버 diff를 그대로 보여 주지 않는다. diff는 해시 대상이 아니라서 추가 줄을 위조할 수 있다.
 * 그래서 기준 문서만 역산하고, 비교는 해시로 검증한 본문으로 화면에서 다시 만든다.
 * 기준 문서 자체는 해시 대상이 아니어서 숨길 수 있다. 화면이 서명 대상은 전체 내용이라고 함께 말한다.
 */
export function compareTaskDocument(document: Pick<TaskDocument, 'documentId' | 'body' | 'diff'>, signedBody: string, target: string): DocumentCompare {
  if (document.body !== signedBody) return { kind: 'mismatch' }
  if (!document.diff) {
    // 새 문서는 빈 문서와 비교하므로, 본문이 있는데 비교가 비어 있을 수 없다.
    return document.documentId === null && splitServerLines(signedBody).length > 0 ? { kind: 'mismatch' } : { kind: 'noChange' }
  }
  const baseLines = reconstructBaseLines(document.diff, target, signedBody)
  if (!baseLines) return { kind: 'mismatch' }
  const isNew = document.documentId === null
  // 새 문서라면서 지워지는 줄이 있으면 말이 맞지 않는다.
  if (isNew && baseLines.length > 0) return { kind: 'mismatch' }
  return compareLines(target, baseLines, signedBody, isNew)
}

/**
 * 롤백 Plan의 비교. 서버 기준은 "이 요청이 만든 첫 버전의 직전"이라 되돌릴 버전과 같은 문서가 되어 비교가 비어 보인다.
 * 그래서 현재 문서 본문을 따로 받아 되돌릴 내용과 비교한다.
 */
export function compareWithCurrent(target: string, currentBody: string, signedBody: string): DocumentCompare {
  return compareLines(target, splitServerLines(currentBody), signedBody, false)
}
