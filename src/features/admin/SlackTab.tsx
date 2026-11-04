import { useMutation, useQuery } from '@tanstack/react-query'
import { Link2, Link2Off, MessageSquare, Settings2 } from 'lucide-react'
import { useState } from 'react'
import { adminApi } from '../../api/endpoints'
import type { SlackIntegration } from '../../api/types'
import { KeyValues } from '../../components/rich'
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

  const StatusIcon = saved ? Link2 : Link2Off

  return (
    <div className="grid items-start gap-4 xl:grid-cols-2">
      <Sheet title="연결 상태" icon={<MessageSquare size={16} aria-hidden />}>
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex size-11 shrink-0 items-center justify-center rounded-lg ${
              saved ? 'bg-low-soft text-low' : 'bg-forbidden-soft text-forbidden'
            }`}
          >
            <StatusIcon size={22} aria-hidden />
          </span>
          <div>
            <p className="text-lg font-bold tracking-tight">{saved ? '연결됨' : '연결 안 됨'}</p>
            <p className="text-[0.8125rem] text-ink-2">
              {saved
                ? `${saved.workspace} 워크스페이스의 ${saved.defaultChannel} 채널로 연결되어 있습니다.`
                : '아직 연결하지 않았습니다. 연결하기 전에는 Slack 알림이 가지 않습니다.'}
            </p>
          </div>
        </div>

        <div className="mt-4 border-t border-rule pt-3">
          <KeyValues
            items={[
              { label: '워크스페이스', value: saved?.workspace ?? '없음' },
              { label: '기본 채널', value: saved?.defaultChannel ?? '없음' },
              { label: '규모별 기본값', value: policy.data.slackNotifications === 'ON' ? '기본 켜짐' : '선택' },
            ]}
          />
        </div>

        <div className="mt-4">
          <p className="mb-1.5 text-xs font-medium text-ink-3">승인 요청 알림은 이렇게 갑니다</p>
          <div className="rounded-lg border border-rule bg-sheet-alt p-3 text-[0.8125rem]">
            <p className="font-semibold text-ink">AI 작업 승인</p>
            <p className="mt-0.5 text-ink-2">승인 요청이 도착했습니다: 로그인 실패 시 에러 메시지를 바꾸고…</p>
            <p className="mt-1 font-medium text-seal">승인 상세 열기</p>
          </div>
          <p className="mt-1.5 text-xs text-ink-3">알림에는 승인 상세 링크만 담습니다. 서명은 서비스 화면에서만 할 수 있습니다.</p>
        </div>
      </Sheet>

      <Sheet title="Slack 연동" icon={<Settings2 size={16} aria-hidden />}>
        <form
          className="flex flex-col gap-3"
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
          <Field label="기본 채널" hint="예: #ai-approvals">
            {(id) => (
              <TextInput
                id={id}
                value={value.defaultChannel}
                onChange={(event) => setDraft({ ...value, defaultChannel: event.target.value })}
              />
            )}
          </Field>
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
    </div>
  )
}
