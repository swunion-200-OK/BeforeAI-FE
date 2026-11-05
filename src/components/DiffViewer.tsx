import { useMemo } from 'react'
import { parseUnifiedDiff, readUnifiedDiff, type DiffCell } from '../lib/diff'
import { CodeBlock } from './ui'

const CELL_BG = {
  context: '',
  removed: 'bg-high-soft',
  added: 'bg-low-soft',
} as const

function Cell({ cell, side }: { cell: DiffCell | null; side: 'left' | 'right' }) {
  const mark = cell?.kind === 'removed' ? '-' : cell?.kind === 'added' ? '+' : ' '
  return (
    <>
      <td
        className={`w-10 select-none border-r border-rule px-2 text-right align-top text-ink-3 ${
          cell ? CELL_BG[cell.kind] : 'bg-sheet-alt'
        }`}
      >
        {cell?.number ?? ''}
      </td>
      <td
        className={`w-1/2 px-2 align-top break-all whitespace-pre-wrap ${
          cell ? CELL_BG[cell.kind] : 'bg-sheet-alt'
        } ${side === 'left' ? 'border-r border-rule-strong' : ''}`}
      >
        {cell && (
          <>
            <span aria-hidden className="mr-1 text-ink-3 select-none">
              {mark}
            </span>
            {cell.text}
          </>
        )}
      </td>
    </>
  )
}

/** unified diff를 좌우로 나란히 보여 준다. */
export function DiffViewer({ diff }: { diff: string }) {
  const rows = useMemo(() => parseUnifiedDiff(diff), [diff])
  const wellFormed = useMemo(() => readUnifiedDiff(diff).wellFormed, [diff])
  // 읽지 못한 변경을 "바뀐 내용 없음"이라고 하면 안 된다. 원문을 그대로 보여 준다.
  if (!wellFormed) return <CodeBlock label="형식을 읽지 못해 원문을 그대로 보여 줍니다">{diff}</CodeBlock>
  if (!rows.some((row) => row.type === 'line')) {
    return <p className="rounded-md border border-rule bg-sheet-alt p-3 text-sm text-ink-3">바뀐 내용이 없습니다.</p>
  }
  return (
    <div className="overflow-x-auto rounded-md border border-rule bg-sheet">
      <table className="w-full min-w-[40rem] table-fixed border-collapse font-mono text-[0.875rem] leading-6">
        <colgroup>
          <col className="w-10" />
          <col />
          <col className="w-10" />
          <col />
        </colgroup>
        <thead className="sr-only">
          <tr>
            <th>이전 줄 번호</th>
            <th>이전</th>
            <th>이후 줄 번호</th>
            <th>이후</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            if (row.type === 'file') {
              return (
                <tr key={index}>
                  <td colSpan={4} className="border-y border-rule bg-sheet-alt px-3 py-1.5 font-medium text-ink-2">
                    {row.path}
                  </td>
                </tr>
              )
            }
            if (row.type === 'hunk') {
              return (
                <tr key={index}>
                  <td colSpan={4} className="border-b border-rule bg-sheet-alt px-3 py-0.5 text-ink-3">
                    {row.header}
                  </td>
                </tr>
              )
            }
            return (
              <tr key={index}>
                <Cell cell={row.left} side="left" />
                <Cell cell={row.right} side="right" />
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
