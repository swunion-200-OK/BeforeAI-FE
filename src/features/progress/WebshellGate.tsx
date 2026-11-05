import { CircleCheck, CircleX, Clock, Minus, ShieldCheck, ShieldX, type LucideIcon } from 'lucide-react'
import { GATE_ID, type GateCheckState, type GatePhase, type GateView } from './progressStatus'

const CHECK_STYLE: Record<GateCheckState, { box: string; word: string; Icon: LucideIcon }> = {
  waiting: { box: 'border-rule-strong bg-sheet text-ink-2', word: '대기', Icon: Clock },
  passed: { box: 'border-low bg-low-soft text-low', word: '통과', Icon: CircleCheck },
  failed: { box: 'border-high bg-high text-white', word: '실패', Icon: CircleX },
  none: { box: 'border-dashed border-rule-strong bg-sheet text-ink-2', word: '결과 없음', Icon: Minus },
}

const FRAME: Record<GatePhase, { frame: string; word: string; wordClass: string; Icon: LucideIcon }> = {
  waiting: { frame: 'border-rule-strong bg-sheet-alt', word: '대기', wordClass: 'text-ink-2', Icon: Clock },
  passed: { frame: 'border-low bg-sheet', word: '모두 통과', wordClass: 'text-low', Icon: ShieldCheck },
  failed: { frame: 'border-high bg-sheet', word: '닫힘: 실행하지 않음', wordClass: 'text-high', Icon: ShieldX },
  unreached: { frame: 'border-rule-strong bg-sheet-alt', word: '검증하지 않음', wordClass: 'text-ink-2', Icon: Minus },
  unknown: { frame: 'border-rule-strong bg-sheet-alt', word: '결과 없음', wordClass: 'text-ink-2', Icon: Minus },
}

/** 승인과 실행 단계 사이의 관문 (API 명세 5.1의 검증 순서). lit이 있으면 검사를 켜는 중이다. */
export function WebshellGate({ gate, lit }: { gate: GateView; lit: number | null }) {
  const replaying = lit !== null
  const allPassed = gate.checks.every((check) => check.state === 'passed')
  const frame = replaying
    ? { ...FRAME.waiting, word: '검증 결과 받는 중' }
    : gate.phase === 'passed' && !allPassed
      ? { ...FRAME.passed, word: '실행 시작함' }
      : FRAME[gate.phase]
  return (
    <section
      data-node-id={GATE_ID}
      data-gate-phase={gate.phase}
      data-gate-lit={lit ?? undefined}
      aria-label="웹쉘 검증 관문"
      className={`@container rounded-lg border-2 px-3.5 py-2.5 ${frame.frame}`}
    >
      <header className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">웹쉘 검증 관문</h3>
        <p className={`flex items-center gap-1.5 text-sm font-semibold ${frame.wordClass}`}>
          <frame.Icon size={16} aria-hidden />
          {frame.word}
        </p>
      </header>
      <ol className="grid grid-cols-2 gap-1.5 @xs:grid-cols-3 @2xl:grid-cols-6">
        {gate.checks.map((check, index) => {
          const state: GateCheckState = replaying && index >= lit ? 'waiting' : check.state
          const { box, word, Icon } = CHECK_STYLE[state]
          return (
            <li
              key={check.key}
              data-check={check.key}
              data-check-state={state}
              className={`rounded-md border px-2 py-1.5 transition-colors duration-150 ${box}`}
            >
              <p className="text-xs leading-tight font-semibold">
                {index + 1}. {check.name}
              </p>
              <p className="mt-0.5 flex items-center gap-1 text-xs">
                <Icon size={13} aria-hidden />
                {word}
              </p>
            </li>
          )
        })}
      </ol>
      {!replaying && gate.failures.length > 0 && (
        <ul className="mt-2.5 flex flex-col gap-0.5 text-sm font-medium text-high">
          {gate.failures.map((failure) => (
            <li key={failure}>{failure}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
