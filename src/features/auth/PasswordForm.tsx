import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { meApi } from '../../api/endpoints'
import { errorMessage } from '../../api/errors'
import { Button, Field, TextInput } from '../../components/ui'

const MIN_LENGTH = 8

/** 비밀번호 변경 폼. 최초 로그인 강제 변경과 내 정보가 같이 쓴다. */
export function PasswordForm({ submitLabel, onDone }: { submitLabel: string; onDone: () => void | Promise<void> }) {
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

  return (
    <form onSubmit={handleSubmit} className="flex max-w-sm flex-col gap-3">
      <Field label="현재 비밀번호">
        {(id) => (
          <TextInput
            id={id}
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        )}
      </Field>
      <Field label="새 비밀번호" hint={`${MIN_LENGTH}자 이상`} error={tooShort ? `${MIN_LENGTH}자 이상 입력해 주세요` : null}>
        {(id) => (
          <TextInput
            id={id}
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        )}
      </Field>
      <Field label="새 비밀번호 확인" error={mismatch ? '새 비밀번호와 같게 입력해 주세요' : null}>
        {(id) => (
          <TextInput
            id={id}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        )}
      </Field>
      {error && (
        <p className="text-sm text-high" role="alert">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" variant="primary" internalOnly disabled={!ready} loading={change.isPending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
