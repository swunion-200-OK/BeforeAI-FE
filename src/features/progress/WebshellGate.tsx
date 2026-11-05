import { CircleX, Clock, Minus, ShieldCheck, ShieldX, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { StatusGlyph } from '../../components/badges'
import { GATE_ID, forbiddenCheckWord, type GateCheckState, type GatePhase, type GateView } from './progressStatus'

/** 실패 칸은 빨간 바탕이라 속이 찬 모양 대신 흰 선 모양을 쓴다 */
const CHECK_STYLE: Record<GateCheckState, { cell: string; state: string; word: string; glyph: ReactNode }> = {
  waiting: { cell: 'bg-sheet text-ink-2', state: 'text-ink-2', word: '대기', glyph: <StatusGlyph shape="wait" size={13} /> },
  passed: { cell: 'bg-sheet text-ink', state: 'text-low', word: '통과', glyph: <StatusGlyph shape="done" size={13} /> },
  failed: { cell: 'bg-high text-white', state: 'font-semibold text-white', word: '실패', glyph: <CircleX size={13} aria-hidden /> },
  none: { cell: 'bg-sheet text-ink-3', state: 'text-ink-3', word: '결과 없음', glyph: <Minus size={13} aria-hidden /> },
}

const FRAME: Record<GatePhase, { frame: string; head: string; word: string; Icon: LucideIcon }> = {
  waiting: { frame: 'border border-rule-strong', head: 'text-ink-2', word: '대기', Icon: Clock },
  passed: { frame: 'border border-low', head: 'text-low', word: '모두 통과', Icon: ShieldCheck },
  failed: { frame: 'border-2 border-high', head: 'text-white', word: '닫힘: 실행하지 않음', Icon: ShieldX },
  unreached: { frame: 'border border-rule-strong', head: 'text-ink-2', word: '검증하지 않음', Icon: Minus },
  unknown: { frame: 'border border-rule-strong', head: 'text-ink-2', word: '결과 없음', Icon: Minus },
}

/**
 * 승인과 실행 단계 사이의 관문 (API 명세 5.1의 검증 순서). lit이 있으면 검사를 켜는 중이다.
 * 트리에서 면을 채우는 곳은 닫힌 관문뿐이다. 발표 화면 뒤쪽에서도 닫힌 것이 보여야 한다.
 */
export function WebshellGate({ gate, lit, forbiddenExcluded = 0 }: { gate: GateView; lit: number | null; forbiddenExcluded?: number }) {
  const replaying = lit !== null
  const allPassed = gate.checks.every((check) => check.state === 'passed')
  const frame = replaying
    ? { ...FRAME.waiting, word: '검증 결과 받는 중' }
    : gate.phase === 'passed' && !allPassed
      ? { ...FRAME.passed, word: '실행 시작함' }
      : FRAME[gate.phase]
  const closed = !replaying && gate.phase === 'failed'
  return (
    <section
      data-node-id={GATE_ID}
      data-gate-phase={gate.phase}
      data-gate-lit={lit ?? undefined}
      aria-label="웹쉘 검증 관문"
      className={`@container overflow-hidden rounded-md bg-sheet transition-colors duration-150 ${frame.frame}`}
    >
      <header className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 transition-colors duration-150 ${closed ? 'bg-high px-3.5 py-2' : 'px-3.5 pt-2.5 pb-2'}`}>
        <h3 className={`text-sm font-semibold ${closed ? 'text-white' : 'text-ink'}`}>웹쉘 검증 관문</h3>
        <p className={`flex items-center gap-1.5 font-semibold ${closed ? 'text-[1.375rem] leading-snug' : 'text-sm'} ${frame.head}`}>
          <frame.Icon size={closed ? 24 : 16} aria-hidden />
          {frame.word}
        </p>
      </header>
      <ol className="grid grid-cols-2 gap-px border-t border-rule bg-rule @xs:grid-cols-3 @3xl:grid-cols-6">
        {gate.checks.map((check, index) => {
          const state: GateCheckState = replaying && index >= lit ? 'waiting' : check.state
          const { cell, state: stateClass, word, glyph } = CHECK_STYLE[state]
          return (
            <li key={check.key} data-check={check.key} data-check-state={state} className={`px-2.5 py-1.5 transition-colors duration-150 ${cell}`}>
              <p className="text-xs leading-tight font-semibold">
                {index + 1}. {check.name}
              </p>
              <p className={`mt-0.5 flex items-center gap-1 text-xs ${stateClass}`}>
                {glyph}
                {check.key === 'forbidden' && state === 'passed' && forbiddenExcluded > 0 ? forbiddenCheckWord(forbiddenExcluded) : word}
              </p>
            </li>
          )
        })}
      </ol>
      {!replaying && gate.failures.length > 0 && (
        <ul className="flex flex-col gap-0.5 border-t border-rule px-3.5 py-2 text-base font-semibold text-high">
          {gate.failures.map((failure) => (
            <li key={failure}>{failure}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
