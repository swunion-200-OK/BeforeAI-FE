import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { adminApi } from '../../api/endpoints'
import type { SlackIntegration } from '../../api/types'
import { toast } from '../../components/toast'
import { Button, ErrorState, Field, Sheet, Spinner, TextInput } from '../../components/ui'
import { useRefreshAll } from '../../lib/queries'
import { policyQuery } from './adminQueries'

const EMPTY: SlackIntegration = { workspace: '', defaultChannel: '' }

export function SlackTab() {
  const refresh = useRefreshAll()
  const policy = useQuery(policyQuery)
  const [draft, setDraft] = useState<SlackIntegration | null>(null)
  const saved = policy.data?.slackIntegration ?? null
  const value = draft ?? saved ?? EMPTY
  const save = useMutation({
    mutationFn: () => adminApi.updateSlack({ workspace: value.workspace.trim(), defaultChannel: value.defaultChannel.trim() }),
    onSuccess: async () => {
      toast.success('Slack 연동을 저장했습니다')
      setDraft(null)
      await refresh()
    },
  })

  if (policy.isPending) return <Spinner />
  if (policy.isError) return <ErrorState error={policy.error} onRetry={() => policy.refetch()} />

  return (
    <Sheet className="max-w-2xl">
      <p className="flex items-center gap-2 text-sm text-ink-2">
        <span aria-hidden className={`size-2 shrink-0 rounded-full ${saved ? 'bg-low' : 'bg-rule-strong'}`} />
        {saved ? `${saved.workspace} 워크스페이스의 ${saved.defaultChannel} 채널로 연결되어 있습니다.` : '아직 연결하지 않았습니다.'}
      </p>
      <form
        className="mt-4 flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (value.workspace.trim() && value.defaultChannel.trim()) save.mutate()
        }}
      >
        <Field label="워크스페이스">
          {(id) => (
            <TextInput id={id} value={value.workspace} onChange={(event) => setDraft({ ...value, workspace: event.target.value })} />
          )}
        </Field>
        <Field label="기본 채널">
          {(id) => (
            <TextInput
              id={id}
              placeholder="#ai-approvals"
              value={value.defaultChannel}
              onChange={(event) => setDraft({ ...value, defaultChannel: event.target.value })}
            />
          )}
        </Field>
        <div className="mt-1">
          <Button
            type="submit"
            variant="primary"
            disabled={!value.workspace.trim() || !value.defaultChannel.trim()}
            disabledReason="워크스페이스와 기본 채널을 입력해 주세요"
            loading={save.isPending}
          >
            Slack 연동 저장
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
