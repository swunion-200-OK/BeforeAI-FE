import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { adminApi } from '../../api/endpoints'
import type { SlackIntegration } from '../../api/types'
import { toast } from '../../components/toast'
import { Banner, Button, ErrorState, Field, Sheet, Spinner, TextInput } from '../../components/ui'
import { useRefreshAll } from '../../lib/queries'

const EMPTY: SlackIntegration = { workspace: '', defaultChannel: '' }

export function SlackTab() {
  const refresh = useRefreshAll()
  const policy = useQuery({ queryKey: ['admin', 'policy'], queryFn: adminApi.policy })
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
    <Sheet title="Slack 연동" className="max-w-xl">
      <div className="mb-4">
        {saved ? (
          <Banner tone="info">
            {saved.workspace} 워크스페이스의 {saved.defaultChannel} 채널로 연결되어 있습니다.
          </Banner>
        ) : (
          <Banner tone="neutral">아직 연결하지 않았습니다. 연결하기 전에는 Slack 알림이 가지 않습니다.</Banner>
        )}
      </div>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          save.mutate()
        }}
      >
        <Field label="워크스페이스">
          {(id) => (
            <TextInput id={id} value={value.workspace} onChange={(event) => setDraft({ ...value, workspace: event.target.value })} />
          )}
        </Field>
        <Field label="기본 채널" hint="예: #ai-approvals">
          {(id) => (
            <TextInput
              id={id}
              value={value.defaultChannel}
              onChange={(event) => setDraft({ ...value, defaultChannel: event.target.value })}
            />
          )}
        </Field>
        <p className="text-xs text-ink-3">알림에는 승인 상세 링크만 담습니다. 서명은 서비스 화면에서만 할 수 있습니다.</p>
        <div>
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
