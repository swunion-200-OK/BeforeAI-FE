import { useMutation, useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { USE_MOCK } from '../../api/client'
import { meApi } from '../../api/endpoints'
import type { Me, NotificationSettings } from '../../api/types'
import { useMe } from '../../app/AuthProvider'
import { NetworkBadge } from '../../components/badges'
import { toast } from '../../components/toast'
import { Button, ErrorState, Field, Mono, PageHeader, Sheet, Spinner, TextInput } from '../../components/ui'
import { ROLE_LABEL } from '../../lib/labels'
import { useDepartmentNames, useNetwork, useRefreshAll } from '../../lib/queries'
import { PasswordForm } from '../auth/PasswordForm'
import { SigningKeySection } from './SigningKeySection'

function ProfileSection({ me }: { me: Me }) {
  const departmentName = useDepartmentNames()
  const network = useNetwork()
  return (
    <Sheet title="계정">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
        <dt className="text-ink-3">이름</dt>
        <dd>{me.name}</dd>
        <dt className="text-ink-3">사번</dt>
        <dd>{me.employeeNo}</dd>
        <dt className="text-ink-3">역할</dt>
        <dd>{ROLE_LABEL[me.role]}</dd>
        <dt className="text-ink-3">부서</dt>
        <dd>{departmentName(me.departmentId)}</dd>
        <dt className="text-ink-3">접속 환경</dt>
        <dd>
          <NetworkBadge network={network} />
        </dd>
      </dl>
    </Sheet>
  )
}

function OtpSection({ me }: { me: Me }) {
  const refreshAll = useRefreshAll()
  const [secret, setSecret] = useState<string | null>(null)
  const [code, setCode] = useState('')

  const start = useMutation({
    mutationFn: () => meApi.enrollOtp(),
    onSuccess: (data) => setSecret(data.secret),
  })
  const confirm = useMutation({
    mutationFn: () => meApi.enrollOtp(code.trim()),
    onSuccess: async () => {
      setSecret(null)
      setCode('')
      toast.success('OTP를 등록했습니다')
      await refreshAll()
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    confirm.mutate()
  }

  return (
    <Sheet
      title="OTP"
      actions={
        secret === null && (
          <Button internalOnly loading={start.isPending} onClick={() => start.mutate()}>
            {me.otpEnrolled ? 'OTP 다시 등록' : 'OTP 등록'}
          </Button>
        )
      }
    >
      {secret === null ? (
        <p className="text-sm text-ink-2">
          {me.otpEnrolled
            ? 'OTP를 등록했습니다. 외부망에서 로그인할 때 OTP 번호를 입력합니다.'
            : '외부망에서 로그인하려면 OTP 앱을 등록해야 합니다.'}
        </p>
      ) : (
        <form onSubmit={submit} className="flex max-w-sm flex-col gap-3">
          <div className="text-sm text-ink-2">
            <p>OTP 앱에 아래 비밀 키를 추가한 뒤, 앱에 표시된 6자리 번호를 입력해 주세요.</p>
            <p className="mt-2 rounded-md bg-sheet-alt px-3 py-2">
              <Mono>{secret}</Mono>
            </p>
          </div>
          <Field label="OTP 번호" hint={USE_MOCK ? '시연용 번호는 123456입니다' : undefined}>
            {(id) => (
              <TextInput
                id={id}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="font-mono tracking-widest"
              />
            )}
          </Field>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={code.trim().length !== 6} loading={confirm.isPending}>
              OTP 확인
            </Button>
            <Button
              onClick={() => {
                setSecret(null)
                setCode('')
              }}
            >
              닫기
            </Button>
          </div>
        </form>
      )}
    </Sheet>
  )
}

function SlackForm({ initial }: { initial: NotificationSettings }) {
  const refreshAll = useRefreshAll()
  const [settings, setSettings] = useState(initial)
  const save = useMutation({
    mutationFn: () => meApi.updateNotificationSettings(settings),
    onSuccess: async () => {
      toast.success('알림 설정을 저장했습니다')
      await refreshAll()
    },
  })
  return (
    <form
      className="flex max-w-sm flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate()
      }}
    >
      <Field label="Slack 사용자 ID">
        {(id) => (
          <TextInput
            id={id}
            value={settings.slackUserId ?? ''}
            onChange={(e) => setSettings({ ...settings, slackUserId: e.target.value || null })}
          />
        )}
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-seal"
          checked={settings.approvalRequests}
          onChange={(e) => setSettings({ ...settings, approvalRequests: e.target.checked })}
        />
        승인 요청이 오면 알림 받기
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-seal"
          checked={settings.requestResults}
          onChange={(e) => setSettings({ ...settings, requestResults: e.target.checked })}
        />
        내 요청의 결과 알림 받기
      </label>
      <p className="text-xs text-ink-3">알림에는 승인 상세 링크만 담습니다. 서명은 이 서비스 화면에서만 합니다.</p>
      <div>
        <Button type="submit" variant="primary" loading={save.isPending}>
          알림 설정 저장
        </Button>
      </div>
    </form>
  )
}

function SlackSection() {
  const settings = useQuery({ queryKey: ['me', 'notification-settings'], queryFn: meApi.notificationSettings })
  return (
    <Sheet title="Slack 알림">
      {settings.isPending && <Spinner />}
      {settings.isError && <ErrorState error={settings.error} onRetry={() => settings.refetch()} />}
      {settings.data && <SlackForm initial={settings.data} />}
    </Sheet>
  )
}

export default function MePage() {
  const me = useMe()
  return (
    <>
      <PageHeader title="내 정보" description="승인 키, 비밀번호, OTP와 Slack 알림을 관리합니다." />
      <div className="flex flex-col gap-4">
        <ProfileSection me={me} />
        <SigningKeySection me={me} />
        <Sheet title="비밀번호">
          <PasswordForm submitLabel="비밀번호 바꾸기" onDone={() => toast.success('비밀번호를 바꿨습니다')} />
        </Sheet>
        <OtpSection me={me} />
        <SlackSection />
      </div>
    </>
  )
}
