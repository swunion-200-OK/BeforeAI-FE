import { ArrowRight, MapPin, RotateCcw, Sparkles, Users } from 'lucide-react'
import type { Task } from '../api/types'
import { diffStats, explanationOf } from '../lib/explain'

/**
 * 예상 변경을 말로 풀어 보여 준다. 어디가, 무엇이, 이전에서 이후로 바뀌고, 누가 영향받고, 되돌릴 수 있는지.
 * 이 설명은 AI가 쓴 참고 자료이고 해시 대상이 아니다. 서명 기준은 아래의 실제 변경 내용이다.
 */
export function ChangeExplanation({ task }: { task: Task }) {
  const explanation = explanationOf(task)
  return (
    <div className="overflow-hidden rounded-lg border border-ai/25 bg-ai-soft/40">
      <div className="flex items-start gap-2 border-b border-ai/15 px-3.5 py-2.5">
        <Sparkles size={16} className="mt-0.5 shrink-0 text-ai" aria-hidden />
        <p className="text-sm font-medium text-ink">{explanation.summary}</p>
      </div>

      {explanation.changes.length > 0 && (
        <ul className="divide-y divide-ai/10 bg-sheet/70">
          {explanation.changes.map((change, index) => (
            <li key={`${change.where}-${index}`} className="px-3.5 py-2.5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-ai-dark">
                  <MapPin size={12} aria-hidden />
                  {change.where}
                </span>
                <span className="text-[0.8125rem] text-ink-2">{change.what}</span>
              </div>
              {(change.before !== undefined || change.after !== undefined) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[0.8125rem]">
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
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-x-4 gap-y-2 border-t border-ai/15 px-3.5 py-2.5 text-[0.8125rem] sm:grid-cols-2">
        {explanation.impact.length > 0 && (
          <div className="flex items-start gap-1.5">
            <Users size={14} className="mt-0.5 shrink-0 text-ink-3" aria-hidden />
            <div>
              <span className="text-xs font-semibold text-ink-2">누가 영향받나요</span>
              {explanation.impact.map((line) => (
                <p key={line} className="text-ink-2">
                  {line}
                </p>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-start gap-1.5">
          <RotateCcw size={14} className="mt-0.5 shrink-0 text-ink-3" aria-hidden />
          <div>
            <span className="text-xs font-semibold text-ink-2">되돌릴 수 있나요</span>
            <p className="text-ink-2">{explanation.undo}</p>
          </div>
        </div>
      </div>
    </div>
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
