import { Check, X } from 'lucide-react'
import type { ReactNode } from 'react'

export interface Step {
  key: string
  label: string
  /** 끝난 시각이나 현재 상태 같은 보조 글 */
  hint?: ReactNode
  state: 'done' | 'current' | 'error' | 'todo'
}

const BAR: Record<Step['state'], string> = {
  done: 'border-seal',
  current: 'border-seal',
  error: 'border-high',
  todo: 'border-rule',
}

const LABEL: Record<Step['state'], string> = {
  done: 'text-ink-2',
  current: 'font-semibold text-ink',
  error: 'font-semibold text-high',
  todo: 'text-ink-3',
}

/** 가로 단계 표시. 지금 어디까지 왔는지 한 줄로 보여 준다. 순서가 있는 흐름에만 쓴다. */
export function Stepper({ steps }: { steps: Step[] }) {
  return (
    <ol className="flex w-full gap-1">
      {steps.map((step) => (
        <li key={step.key} className={`min-w-0 flex-1 border-t-2 pt-1.5 ${BAR[step.state]}`} aria-current={step.state === 'current' ? 'step' : undefined}>
          <span className={`inline-flex items-center gap-1 text-base ${LABEL[step.state]}`}>
            {step.state === 'done' && <Check size={15} className="shrink-0 text-seal" aria-hidden />}
            {step.state === 'error' && <X size={15} className="shrink-0" aria-hidden />}
            {step.label}
          </span>
          {step.hint && <span className="block text-xs text-ink-3">{step.hint}</span>}
        </li>
      ))}
    </ol>
  )
}
