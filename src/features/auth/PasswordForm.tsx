import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { meApi } from '../../api/endpoints'
import { errorMessage } from '../../api/errors'
import { Button, Field, TextInput } from '../../components/ui'
import { AUTH_BUTTON_CLASS, AuthField } from './AuthField'

const MIN_LENGTH = 8

/** 비밀번호 변경 폼. 최초 로그인 강제 변경과 내 정보가 같이 쓴다. */
export function PasswordForm({
  submitLabel,
  onDone,
  inline,
  large,
}: {
  submitLabel: string
  onDone: () => void | Promise<void>
  /** 넓은 칸에서 입력란을 한 줄에 놓는다 */
  inline?: boolean
  /** 로그인 전 화면의 큰 크기로 그린다 */
  large?: boolean
}) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)

  const change = useMutation({
    meta: { silent: true },
    mutationFn: () => meApi.changePassword(current, next),
    onSuccess: async () => {
      setCurrent('')
      setNext('')
      setConfirm('')
      await onDone()
    },
    onError: (reason) => setError(errorMessage(reason)),
  })

  const tooShort = next.length > 0 && next.length < MIN_LENGTH
  const mismatch = confirm.length > 0 && confirm !== next
  const ready = current && next.length >= MIN_LENGTH && confirm === next

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!ready) return
    setError(null)
    change.mutate()
  }

  const fields = [
    {
      label: '현재 비밀번호',
      autoComplete: 'current-password',
      value: current,
      onChange: setCurrent,
      hint: undefined,
      error: null,
    },
    {
      label: '새 비밀번호',
      autoComplete: 'new-password',
      value: next,
      onChange: setNext,
      hint: `${MIN_LENGTH}자 이상`,
      error: tooShort ? `${MIN_LENGTH}자 이상 입력해 주세요` : null,
    },
    {
      label: '새 비밀번호 확인',
      autoComplete: 'new-password',
      value: confirm,
      onChange: setConfirm,
      hint: undefined,
      error: mismatch ? '새 비밀번호와 같게 입력해 주세요' : null,
    },
  ]

  return (
    <form onSubmit={handleSubmit} className={`flex flex-col ${large ? 'gap-4' : 'gap-3'}`}>
      <div className={inline ? 'grid grid-cols-3 items-start gap-3' : `flex flex-col ${large ? 'gap-4' : 'gap-3'}`}>
        {fields.map((field) =>
          large ? (
            <AuthField
              key={field.label}
              label={field.label}
              type="password"
              autoComplete={field.autoComplete}
              value={field.value}
              hint={field.hint}
              error={field.error}
              onChange={(e) => field.onChange(e.target.value)}
            />
          ) : (
            <Field key={field.label} label={field.label} hint={field.hint} error={field.error}>
              {(id) => (
                <TextInput
                  id={id}
                  type="password"
                  autoComplete={field.autoComplete}
                  value={field.value}
                  onChange={(e) => field.onChange(e.target.value)}
                />
              )}
            </Field>
          ),
        )}
      </div>
      {error && (
        <p className={`${large ? 'text-base' : 'text-sm'} text-high`} role="alert">
          {error}
        </p>
      )}
      <div>
        <Button
          type="submit"
          variant="primary"
          size={large ? 'lg' : 'md'}
          className={large ? AUTH_BUTTON_CLASS : ''}
          internalOnly
          disabled={!ready}
          loading={change.isPending}
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
