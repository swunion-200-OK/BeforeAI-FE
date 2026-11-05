import { createTwoFilesPatch } from 'diff'

export function makeUnifiedDiff(path: string, before: string, after: string): string {
  return createTwoFilesPatch(`a/${path}`, `b/${path}`, before, after, '', '', { context: 3 })
    .split('\n')
    .filter((line) => !line.startsWith('===='))
    .map((line) => line.replace(/\t$/, ''))
    .join('\n')
}

export interface DiffCell {
  number: number
  text: string
  kind: 'context' | 'removed' | 'added'
}

export type DiffRow =
  | { type: 'file'; path: string }
  | { type: 'hunk'; header: string }
  | { type: 'line'; left: DiffCell | null; right: DiffCell | null }

export interface DiffHunk {
  header: string
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: Array<{ kind: DiffCell['kind']; text: string }>
}

export interface DiffFile {
  oldPath: string | null
  path: string | null
  hunks: DiffHunk[]
}

export interface ParsedDiff {
  /** false면 hunk 머리글의 줄 수와 내용이 맞지 않거나 diff가 아닌 줄이 있다. 읽은 만큼만 files에 있다 */
  wellFormed: boolean
  files: DiffFile[]
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/
/** hunk 밖에 올 수 있는 git·diff 머리글. 내용으로 보지 않는다 */
const META_LINE = /^(diff |index |Index: |new file|deleted file|old mode|new mode|similarity |dissimilarity |rename |copy |Binary files |={3,}$|$)/
const KIND_OF_MARK: Record<string, DiffCell['kind']> = { ' ': 'context', '-': 'removed', '+': 'added' }

const ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 }

/** git은 한글 경로를 "b/\355\225\234.md"처럼 따옴표와 8진수 바이트로 적는다. UTF-8로 풀어 사람이 읽는 경로로 만든다. */
function unquotePath(raw: string): string {
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) return raw
  const inner = raw.slice(1, -1)
  const encoder = new TextEncoder()
  const bytes: number[] = []
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index]
    if (char !== '\\') {
      const point = String.fromCodePoint(inner.codePointAt(index) as number)
      bytes.push(...encoder.encode(point))
      index += point.length - 1
      continue
    }
    const octal = /^[0-7]{3}/.exec(inner.slice(index + 1, index + 4))
    if (octal) {
      bytes.push(parseInt(octal[0], 8))
      index += 3
    } else {
      const next = inner[index + 1] ?? ''
      bytes.push(ESCAPES[next] ?? next.charCodeAt(0))
      index += 1
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

const headerPath = (line: string, prefix: RegExp) => unquotePath(line.slice(4).replace(/\t.*$/, '')).replace(prefix, '')

/**
 * unified diff를 읽는다. `--- `와 `+++ `는 hunk 밖에서만 머리글이다.
 * hunk 안은 머리글이 적은 줄 수로 경계를 세므로, `-- 주석`을 지운 줄(`--- 주석`)을 머리글로 오해하지 않는다.
 */
export function readUnifiedDiff(text: string): ParsedDiff {
  const files: DiffFile[] = []
  let wellFormed = true
  let file: DiffFile | null = null
  let hunk: DiffHunk | null = null
  let pendingOldPath: string | null = null
  // 메타 줄 뒤에 파일 머리글이 아직 없다. 바이너리나 이름만 바뀐 변경은 그릴 내용이 없으므로 "바뀐 내용 없음"이라고 하면 안 된다.
  let metaOnly = false
  let oldLeft = 0
  let newLeft = 0

  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()

  for (const line of lines) {
    if (line.startsWith('\\')) continue // "\ No newline at end of file"
    if (hunk && (oldLeft > 0 || newLeft > 0)) {
      const kind = KIND_OF_MARK[line[0]]
      const fits = kind === 'context' ? oldLeft > 0 && newLeft > 0 : kind === 'removed' ? oldLeft > 0 : kind === 'added' ? newLeft > 0 : false
      if (fits) {
        hunk.lines.push({ kind, text: line.slice(1) })
        if (kind !== 'added') oldLeft -= 1
        if (kind !== 'removed') newLeft -= 1
        continue
      }
      // 줄 수가 모자란 hunk다. 끊고 이 줄을 hunk 밖의 줄로 다시 본다.
      wellFormed = false
      hunk = null
    }
    if (line.startsWith('--- ')) {
      if (pendingOldPath !== null) wellFormed = false
      pendingOldPath = headerPath(line, /^a\//)
      hunk = null
      continue
    }
    if (line.startsWith('+++ ')) {
      if (pendingOldPath === null) wellFormed = false
      file = { oldPath: pendingOldPath, path: headerPath(line, /^b\//), hunks: [] }
      files.push(file)
      pendingOldPath = null
      metaOnly = false
      hunk = null
      continue
    }
    const header = HUNK_HEADER.exec(line)
    if (header) {
      if (pendingOldPath !== null) wellFormed = false
      if (!file) {
        file = { oldPath: null, path: null, hunks: [] }
        files.push(file)
      }
      oldLeft = header[2] === undefined ? 1 : Number(header[2])
      newLeft = header[4] === undefined ? 1 : Number(header[4])
      hunk = { header: line, oldStart: Number(header[1]), oldCount: oldLeft, newStart: Number(header[3]), newCount: newLeft, lines: [] }
      file.hunks.push(hunk)
      continue
    }
    if (!META_LINE.test(line)) {
      wellFormed = false
    } else if (line !== '') {
      if (line.startsWith('diff ') && metaOnly) wellFormed = false
      metaOnly = true
    }
  }
  if (pendingOldPath !== null || metaOnly || oldLeft > 0 || newLeft > 0) wellFormed = false
  return { wellFormed, files }
}

/** diff 끝에 추가 줄을 하나 더한다. 줄 수를 세어 읽으므로 마지막 hunk 머리글의 추가 줄 수도 함께 늘린다. */
export function appendAddedLine(diff: string, text: string): string {
  const lines = diff.replace(/\n+$/, '').split('\n')
  const at = lines.findLastIndex((line) => HUNK_HEADER.test(line))
  if (at !== -1) {
    lines[at] = lines[at].replace(/^(@@ -\S+ \+\d+)(?:,(\d+))?( @@)/, (_all, start: string, count: string | undefined, end: string) => `${start},${(count === undefined ? 1 : Number(count)) + 1}${end}`)
  }
  return `${lines.join('\n')}\n+${text}\n`
}

/** unified diff를 좌우 비교 행으로 바꾼다. 연속한 삭제·추가는 같은 행에 나란히 놓는다. */
export function parseUnifiedDiff(text: string): DiffRow[] {
  const rows: DiffRow[] = []
  for (const file of readUnifiedDiff(text).files) {
    if (file.path !== null) rows.push({ type: 'file', path: file.path })
    for (const hunk of file.hunks) {
      rows.push({ type: 'hunk', header: hunk.header })
      let oldLine = hunk.oldStart
      let newLine = hunk.newStart
      let removed: DiffCell[] = []
      let added: DiffCell[] = []
      const flush = () => {
        const length = Math.max(removed.length, added.length)
        for (let i = 0; i < length; i++) {
          rows.push({ type: 'line', left: removed[i] ?? null, right: added[i] ?? null })
        }
        removed = []
        added = []
      }
      for (const { kind, text: content } of hunk.lines) {
        if (kind === 'removed') {
          removed.push({ number: oldLine++, text: content, kind })
        } else if (kind === 'added') {
          added.push({ number: newLine++, text: content, kind })
        } else {
          flush()
          rows.push({
            type: 'line',
            left: { number: oldLine++, text: content, kind },
            right: { number: newLine++, text: content, kind },
          })
        }
      }
      flush()
    }
  }
  return rows
}
