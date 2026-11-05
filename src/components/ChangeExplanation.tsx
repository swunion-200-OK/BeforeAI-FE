import { ArrowRight } from 'lucide-react'
import type { Risk, Task, TaskChangeItem, TaskType } from '../api/types'
import { diffStats, explanationOf } from '../lib/explain'
import { useDepartmentNames } from '../lib/queries'

function BeforeAfter({ change }: { change: TaskChangeItem }) {
  if (change.before === undefined && change.after === undefined) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      {change.before !== undefined && (
        <span className="rounded-sm bg-high-soft px-1.5 py-0.5 text-high">
          <span className="sr-only">이전: </span>
          {change.before}
        </span>
      )}
      {change.before !== undefined && change.after !== undefined && (
        <ArrowRight size={15} className="text-ink-3" aria-label="에서" />
      )}
      {change.after !== undefined && (
        <span className="rounded-sm bg-low-soft px-1.5 py-0.5 text-low">
          <span className="sr-only">이후: </span>
          {change.after}
        </span>
      )}
    </div>
  )
}

/**
 * 예상 변경을 말로 풀어 보여 준다. 한 문장과 이전 → 이후만 먼저 보여 주고, 나머지는 "자세히"에 둔다.
 * 이 설명은 AI가 쓴 참고 자료이고 해시 대상이 아니다. 서명 기준은 실제 변경 내용이다.
 */
export function ChangeSummary({ task, showPairs = true }: { task: Task; showPairs?: boolean }) {
  const explanation = explanationOf(task)
  const pairs = showPairs
    ? explanation.changes.filter((change) => change.before !== undefined || change.after !== undefined)
    : []
  return (
    <div className="mt-2">
      <p className="text-base text-ink">
        {/* 서버 응답에는 AI 설명이 없다. 그때 문장은 화면이 내용에서 뽑은 것이라 AI 설명이라고 하지 않는다. */}
        {task.explanation && <span className="mr-2 text-xs font-medium text-ink-3">AI 설명</span>}
        {explanation.summary}
      </p>
      {pairs.slice(0, 2).map((change, index) => (
        <div key={index} className="mt-1.5">
          <BeforeAfter change={change} />
        </div>
      ))}
    </div>
  )
}

/** 위험도가 높을수록 눈에 띄도록 왼쪽 선과 제목 색을 위험도에 맞춘다. */
const IMPACT_TONE: Record<Risk, { edge: string; label: string }> = {
  LOW: { edge: 'border-low', label: 'text-low' },
  MEDIUM: { edge: 'border-medium', label: 'text-medium' },
  HIGH: { edge: 'border-high', label: 'text-high' },
  FORBIDDEN: { edge: 'border-forbidden', label: 'text-forbidden' },
}

/** 접힌 카드에서 보이는 영향 한 줄. 펼치면 아래의 큰 칸이 대신한다. */
export function ImpactLine({ task }: { task: Task }) {
  const [first] = explanationOf(task).impact
  if (!first) return null
  return <p className={`mt-2.5 border-l-3 pl-3 text-base font-medium text-ink ${IMPACT_TONE[task.risk].edge}`}>{first}</p>
}

/** 되돌리기는 문서만 지원한다(버전 롤백). 읽기만 하는 조회는 바뀌는 것이 없다. */
function undoVerdict(type: TaskType): { text: string; safe: boolean } {
  if (type === 'DOC') return { text: '되돌릴 수 있습니다', safe: true }
  if (type === 'DATA_READ') return { text: '바뀌는 것이 없습니다', safe: true }
  return { text: '바로 되돌릴 수 없습니다', safe: false }
}

const PLAIN_TITLE = 'text-sm font-semibold text-ink-2'

/**
 * "자세히"를 열면 가장 먼저 보이는 내용. 승인자가 판단하는 데 필요한 순서대로 놓는다.
 * 누가 영향받는지가 주인공이고, 어디가 바뀌는지와 되돌릴 수 있는지가 뒤따른다.
 */
export function ChangeDetails({ task }: { task: Task }) {
  const explanation = explanationOf(task)
  const departmentName = useDepartmentNames()
  const tone = IMPACT_TONE[task.risk]
  const undo = undoVerdict(task.type)
  return (
    <div className="flex flex-col gap-6">
      {explanation.impact.length > 0 && (
        <section aria-label="누가 영향받나요" className={`border-l-3 py-0.5 pl-4 ${tone.edge}`}>
          <h4 className={`text-base font-semibold ${tone.label}`}>누가 영향받나요</h4>
          <ul className="mt-1.5 flex flex-col gap-1 text-[1.25rem] leading-snug font-semibold text-ink">
            {explanation.impact.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {task.relatedDepartments.length > 0 && (
            <p className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-ink-3">
              관련 부서
              {task.relatedDepartments.map((id) => (
                <span key={id} className="font-medium text-ink">
                  {departmentName(id)}
                </span>
              ))}
            </p>
          )}
        </section>
      )}

      <div className="grid grid-cols-[3fr_2fr] gap-8">
        <section aria-label="어디가 바뀌나요">
          <h4 className={PLAIN_TITLE}>어디가 바뀌나요</h4>
          <ul className="mt-2 flex flex-col gap-3">
            {explanation.changes.map((change, index) => (
              <li key={index} className="flex flex-col gap-1">
                <p className="text-base font-medium text-ink">{change.where}</p>
                <p className="text-base text-ink-2">{change.what}</p>
                <BeforeAfter change={change} />
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="되돌릴 수 있나요">
          <h4 className={PLAIN_TITLE}>되돌릴 수 있나요</h4>
          <p className={`mt-2 text-base font-semibold ${undo.safe ? 'text-low' : 'text-medium'}`}>{undo.text}</p>
          <p className="mt-1 text-sm text-ink-2">{explanation.undo}</p>
        </section>
      </div>
    </div>
  )
}

/** 실제 변경의 크기. 서명 대상인 내용에서 직접 계산하므로 AI 설명과 별개로 믿을 수 있다. */
export function ChangeStats({ task }: { task: Task }) {
  const { diff, command, query, body } = task.content ?? {}
  if (diff !== undefined) {
    const stats = diffStats(diff)
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-ink-3 tabular-nums">
        파일 {Math.max(stats.files, 1)}개
        <span className="font-medium text-low">+{stats.added}</span>
        <span className="font-medium text-high">−{stats.removed}</span>
      </span>
    )
  }
  if (command !== undefined) return <span className="text-sm text-ink-3">명령 1개</span>
  if (query !== undefined) return <span className="text-sm text-ink-3">쿼리 1개</span>
  if (body !== undefined) return <span className="text-sm text-ink-3">문서 {body.split('\n').length}줄</span>
  return null
}
