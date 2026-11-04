import { Check, Loader2, X } from 'lucide-react'
import { SIGN_STEPS, type SignStep } from './approvalFlow'

export type SignRunState = 'running' | 'done' | 'failed'

/** 서명 진행 단계: 해시 확인 → 서명 → 암호화 → 제출 */
export function SignProgress({ step, state }: { step: SignStep | null; state: SignRunState }) {
  const activeIndex = SIGN_STEPS.findIndex((item) => item.id === step)
  return (
    <ol className="flex items-start" aria-label="서명 진행 단계">
      {SIGN_STEPS.map((item, index) => {
        const finished = state === 'done' || index < activeIndex
        const active = index === activeIndex && state === 'running'
        const failed = index === activeIndex && state === 'failed'
        return (
          <li key={item.id} className="relative flex flex-1 flex-col items-center gap-1 text-center">
            {index > 0 && (
              <span
                aria-hidden
                className={`absolute top-3 right-1/2 h-px w-full ${index <= activeIndex || state === 'done' ? 'bg-seal' : 'bg-rule-strong'}`}
              />
            )}
            <span
              className={`relative flex size-6 items-center justify-center rounded-full border text-xs font-medium ${
                failed
                  ? 'border-high bg-high text-white'
                  : finished
                    ? 'border-seal bg-seal text-white'
                    : active
                      ? 'border-seal bg-sheet text-seal'
                      : 'border-rule-strong bg-sheet text-ink-3'
              }`}
            >
              {failed ? (
                <X size={13} aria-hidden />
              ) : finished ? (
                <Check size={13} aria-hidden />
              ) : active ? (
                <Loader2 size={13} className="animate-spin" aria-hidden />
              ) : null}
            </span>
            <span className={`text-xs ${active || failed ? 'font-medium text-ink' : 'text-ink-2'}`}>{item.label}</span>
          </li>
        )
      })}
    </ol>
  )
}
