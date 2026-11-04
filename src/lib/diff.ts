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

/** unified diff를 좌우 비교 행으로 바꾼다. 연속한 삭제·추가는 같은 행에 나란히 놓는다. */
export function parseUnifiedDiff(text: string): DiffRow[] {
  const rows: DiffRow[] = []
  let oldLine = 0
  let newLine = 0
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

  for (const line of text.split('\n')) {
    if (line.startsWith('--- ')) {
      flush()
      continue
    }
    if (line.startsWith('+++ ')) {
      rows.push({ type: 'file', path: line.slice(4).replace(/^b\//, '') })
      continue
    }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line)
    if (hunk) {
      flush()
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      rows.push({ type: 'hunk', header: line })
      continue
    }
    if (line.startsWith('-')) {
      removed.push({ number: oldLine++, text: line.slice(1), kind: 'removed' })
    } else if (line.startsWith('+')) {
      added.push({ number: newLine++, text: line.slice(1), kind: 'added' })
    } else if (line.startsWith(' ')) {
      flush()
      const content = line.slice(1)
      rows.push({
        type: 'line',
        left: { number: oldLine++, text: content, kind: 'context' },
        right: { number: newLine++, text: content, kind: 'context' },
      })
    }
  }
  flush()
  return rows
}
