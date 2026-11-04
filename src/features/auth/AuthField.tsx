import { useId, type InputHTMLAttributes, type ReactNode } from 'react'

const INPUT_CLASS =
  'h-[3.25rem] w-full rounded-lg border border-rule-strong bg-sheet px-4 text-base text-ink placeholder:text-ink-3 focus:border-seal focus:ring-2 focus:ring-seal/30 focus:outline-none disabled:bg-sheet-alt disabled:text-ink-3'

/** 로그인 전 화면의 큰 입력칸. 첫 화면이라 앱 안의 입력칸보다 시원하게 쓴다. */
export function AuthField({
  label,
  hint,
  error,
  className = '',
  ...input
}: {
  label: string
  hint?: ReactNode
  error?: string | null
} & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[0.9375rem] font-medium text-ink">
        {label}
      </label>
      <input id={id} {...input} className={`${INPUT_CLASS} ${className}`} />
      {hint && !error && <p className="text-sm text-ink-3">{hint}</p>}
      {error && <p className="text-sm text-high">{error}</p>}
    </div>
  )
}

/** 로그인 전 화면의 큰 실행 버튼 크기. Button의 size보다 우선한다. */
export const AUTH_BUTTON_CLASS = 'h-[3.375rem]! w-full rounded-lg! text-[1.0625rem]!'
