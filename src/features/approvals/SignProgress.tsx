import { Check, Loader2, X } from 'lucide-react'
import { SIGN_STEPS, type SignStep } from './approvalFlow'

export type SignRunState = 'running' | 'done' | 'failed'

/** 서명 진행 단계: 해시 확인 → 서명 → 암호화 → 제출 */
export function SignProgress({ step, state }: { step: SignStep | null; state: SignRunState }) {
  const activeIndex = SIGN_STEPS.findIndex((item) => item.id === step)
  return (
    <ol className="flex gap-1" aria-label="서명 진행 단계">
      {SIGN_STEPS.map((item, index) => {
        const finished = state === 'done' || index < activeIndex
        const active = index === activeIndex && state === 'running'
        const failed = index === activeIndex && state === 'failed'
        return (
          <li
            key={item.id}
            className={`min-w-0 flex-1 border-t-2 pt-1 ${failed ? 'border-high' : finished || active ? 'border-seal' : 'border-rule'}`}
          >
            <span className={`flex h-4 items-center ${failed ? 'text-high' : 'text-seal'}`}>
              {failed ? (
                <X size={13} aria-hidden />
              ) : finished ? (
                <Check size={13} aria-hidden />
              ) : active ? (
                <Loader2 size={13} className="animate-spin" aria-hidden />
              ) : null}
            </span>
            <span className={`block text-xs ${failed ? 'font-medium text-high' : active ? 'font-medium text-ink' : 'text-ink-2'}`}>{item.label}</span>
          </li>
        )
      })}
    </ol>
  )
}
