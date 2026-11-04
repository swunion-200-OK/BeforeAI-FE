import { Check, X } from 'lucide-react'
import type { ReactNode } from 'react'

export interface Step {
  key: string
  label: string
  /** 끝난 시각이나 현재 상태 같은 보조 글 */
  hint?: ReactNode
  state: 'done' | 'current' | 'error' | 'todo'
}

/** 가로 단계 표시. 지금 어디까지 왔는지 한 줄로 보여 준다. 순서가 있는 흐름에만 쓴다. */
export function Stepper({ steps }: { steps: Step[] }) {
  return (
    <ol className="flex w-full">
      {steps.map((step, index) => (
        <li key={step.key} className="relative flex flex-1 flex-col items-center text-center" aria-current={step.state === 'current' ? 'step' : undefined}>
          {index > 0 && (
            <span
              aria-hidden
              className={`absolute top-3.5 right-1/2 h-0.5 w-full ${
                step.state === 'todo' ? 'bg-rule-strong' : step.state === 'error' ? 'bg-high' : 'bg-seal'
              }`}
            />
          )}
          <span
            className={`relative z-10 inline-flex size-7 items-center justify-center rounded-full text-xs font-semibold ${
              step.state === 'done'
                ? 'bg-seal text-white'
                : step.state === 'current'
                  ? 'bg-sheet text-seal ring-2 ring-seal'
                  : step.state === 'error'
                    ? 'bg-high text-white'
                    : 'bg-paper text-ink-3 ring-1 ring-rule-strong'
            }`}
          >
            {step.state === 'done' ? (
              <Check size={15} aria-hidden />
            ) : step.state === 'error' ? (
              <X size={15} aria-hidden />
            ) : (
              index + 1
            )}
          </span>
          <span
            className={`mt-1.5 text-base ${
              step.state === 'todo' ? 'text-ink-3' : 'font-semibold text-ink'
            } ${step.state === 'error' ? 'text-high' : ''}`}
          >
            {step.label}
          </span>
          {step.hint && <span className="text-xs text-ink-3">{step.hint}</span>}
        </li>
      ))}
    </ol>
  )
}
