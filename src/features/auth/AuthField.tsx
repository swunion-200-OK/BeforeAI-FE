import { useId, type InputHTMLAttributes, type ReactNode } from 'react'

const INPUT_CLASS =
  'h-[3.25rem] w-full rounded-md border border-rule-input bg-sheet px-4 text-base text-ink placeholder:text-ink-3 focus:border-seal focus:outline-2 focus:-outline-offset-1 focus:outline-seal disabled:border-rule disabled:bg-sheet-alt disabled:text-ink-3'

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
      <label htmlFor={id} className="text-base font-semibold text-ink">
        {label}
      </label>
      <input id={id} {...input} className={`${INPUT_CLASS} ${className}`} />
      {hint && !error && <p className="text-sm text-ink-3">{hint}</p>}
      {error && <p className="text-sm text-high">{error}</p>}
    </div>
  )
}

/** 로그인 전 화면의 큰 실행 버튼 크기. Button의 size보다 우선한다. */
export const AUTH_BUTTON_CLASS = 'h-[3.375rem]! w-full text-[1.0625rem]!'
