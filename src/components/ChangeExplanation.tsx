import { ArrowRight, Sparkles } from 'lucide-react'
import type { Task } from '../api/types'
import { diffStats, explanationOf } from '../lib/explain'

/**
 * 예상 변경을 말로 풀어 보여 준다. 한 문장과 이전 → 이후만 먼저 보여 주고, 나머지는 "자세히"에 둔다.
 * 이 설명은 AI가 쓴 참고 자료이고 해시 대상이 아니다. 서명 기준은 실제 변경 내용이다.
 */
export function ChangeSummary({ task }: { task: Task }) {
  const explanation = explanationOf(task)
  const pairs = explanation.changes.filter((change) => change.before !== undefined || change.after !== undefined)
  return (
    <div className="mt-1.5">
      <p className="flex items-start gap-1.5 text-[0.9375rem] text-ink">
        <Sparkles size={14} className="mt-1 shrink-0 text-ai" aria-label="AI 설명" />
        <span>{explanation.summary}</span>
      </p>
      {pairs.slice(0, 2).map((change, index) => (
        <div key={index} className="mt-1.5 ml-5 flex flex-wrap items-center gap-1.5 text-sm">
          {change.before !== undefined && (
            <span className="rounded bg-high-soft px-1.5 py-0.5 text-high">
              <span className="sr-only">이전: </span>
              {change.before}
            </span>
          )}
          {change.before !== undefined && change.after !== undefined && (
            <ArrowRight size={14} className="text-ink-3" aria-label="에서" />
          )}
          {change.after !== undefined && (
            <span className="rounded bg-low-soft px-1.5 py-0.5 text-low">
              <span className="sr-only">이후: </span>
              {change.after}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

/** "자세히"를 열면 보이는 내용: 어디가 바뀌고, 누가 영향받고, 되돌릴 수 있는지. */
export function ChangeDetails({ task }: { task: Task }) {
  const explanation = explanationOf(task)
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      <dt className="text-ink-3">어디가 바뀌나요</dt>
      <dd className="text-ink-2">
        {explanation.changes.map((change, index) => (
          <p key={index}>
            <span className="font-medium text-ink">{change.where}</span> {change.what}
          </p>
        ))}
      </dd>
      {explanation.impact.length > 0 && (
        <>
          <dt className="text-ink-3">누가 영향받나요</dt>
          <dd className="text-ink-2">
            {explanation.impact.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </dd>
        </>
      )}
      <dt className="text-ink-3">되돌릴 수 있나요</dt>
      <dd className="text-ink-2">{explanation.undo}</dd>
    </dl>
  )
}

/** 실제 변경의 크기. 서명 대상인 내용에서 직접 계산하므로 AI 설명과 별개로 믿을 수 있다. */
export function ChangeStats({ task }: { task: Task }) {
  const { diff, command, query, body } = task.content
  if (diff !== undefined) {
    const stats = diffStats(diff)
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-ink-3 tabular-nums">
        파일 {Math.max(stats.files, 1)}개
        <span className="font-medium text-low">+{stats.added}</span>
        <span className="font-medium text-high">−{stats.removed}</span>
      </span>
    )
  }
  if (command !== undefined) return <span className="text-xs text-ink-3">명령 1개</span>
  if (query !== undefined) return <span className="text-xs text-ink-3">쿼리 1개</span>
  if (body !== undefined) return <span className="text-xs text-ink-3">문서 {body.split('\n').length}줄</span>
  return null
}
