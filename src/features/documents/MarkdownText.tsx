import { useMemo } from 'react'

/**
 * 기획서·문서 본문을 읽기 좋게 보여 준다. 제목, 목록, 표, 문단만 구분한다.
 * HTML을 해석하지 않고 글자로만 그리므로 본문에 태그가 있어도 실행되지 않는다.
 */
type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'paragraph'; text: string }

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim())

function parse(source: string): Block[] {
  const blocks: Block[] = []
  const lines = source.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const heading = /^(#{1,3}) (.+)$/.exec(line)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length as 1 | 2 | 3, text: heading[2] })
    } else if (/^\s*[-*] /.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*] /.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*] /, ''))
      i--
      blocks.push({ kind: 'list', items })
    } else if (line.trim().startsWith('|')) {
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        // 머리글 아래 구분선(|---|)은 내용이 아니다.
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(cells(lines[i]))
        i++
      }
      i--
      blocks.push({ kind: 'table', header: rows[0] ?? [], rows: rows.slice(1) })
    } else if (line.trim()) {
      blocks.push({ kind: 'paragraph', text: line })
    }
  }
  return blocks
}

const HEADING_CLASS = {
  1: 'mt-5 text-lg font-semibold first:mt-0',
  2: 'mt-4 border-b border-rule pb-1 text-base font-semibold first:mt-0',
  3: 'mt-3 text-sm font-semibold first:mt-0',
}

export function MarkdownText({ body }: { body: string }) {
  const blocks = useMemo(() => parse(body), [body])
  return (
    <div className="flex max-w-[80ch] flex-col gap-2 text-sm leading-relaxed text-ink">
      {blocks.map((block, index) => {
        if (block.kind === 'heading') {
          const Tag = (['h3', 'h4', 'h5'] as const)[block.level - 1]
          return (
            <Tag key={index} className={HEADING_CLASS[block.level]}>
              {block.text}
            </Tag>
          )
        }
        if (block.kind === 'list') {
          return (
            <ul key={index} className="flex list-disc flex-col gap-0.5 pl-5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </ul>
          )
        }
        if (block.kind === 'table') {
          return (
            <div key={index} className="overflow-hidden rounded-lg border border-rule">
              <table className="sheet-table">
                <thead>
                  <tr>
                    {block.header.map((cell, cellIndex) => (
                      <th key={cellIndex}>{cell}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
        return <p key={index}>{block.text}</p>
      })}
    </div>
  )
}
