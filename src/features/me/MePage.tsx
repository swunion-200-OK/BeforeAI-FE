import { useMutation, useQuery } from '@tanstack/react-query'
import { useState, type FormEvent, type ReactNode } from 'react'
import { USE_MOCK } from '../../api/client'
import { meApi } from '../../api/endpoints'
import { ApiError, errorMessage } from '../../api/errors'
import { isMissingOnServer, MISSING_ON_SERVER_MESSAGE } from '../../api/missingOnServer'
import type { NotificationSettings } from '../../api/types'
import { useMe } from '../../app/AuthProvider'
import { toast } from '../../components/toast'
import { Button, ErrorState, Field, Modal, Mono, PageHeader, Sheet, Spinner, TextInput } from '../../components/ui'
import { ROLE_LABEL } from '../../lib/labels'
import { useDepartmentNames, useRefreshAll } from '../../lib/queries'
import { PasswordForm } from '../auth/PasswordForm'
import { SigningKeySection } from './SigningKeySection'

/** 설정 한 줄: 이름, 지금 값, 버튼. 입력은 버튼을 눌러 여는 창에서 한다. */
function SettingRow({
  title,
  value,
  action,
  children,
}: {
  title: string
  value?: ReactNode
  action: ReactNode
  children?: ReactNode
}) {
  return (
    <li className="flex items-center gap-4 px-6 py-4">
      <span className="w-28 shrink-0 text-sm font-medium">{title}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-ink-3">{value}</span>
      {action}
      {children}
    </li>
  )
}

function PasswordRow() {
  const [open, setOpen] = useState(false)
  return (
    <SettingRow
      title="비밀번호"
      action={
        <Button size="sm" aria-label="비밀번호 변경" onClick={() => setOpen(true)}>
          변경
        </Button>
      }
    >
      <Modal open={open} title="비밀번호 변경" onClose={() => setOpen(false)}>
        <PasswordForm
          submitLabel="비밀번호 바꾸기"
          onDone={() => {
            setOpen(false)
            toast.success('비밀번호를 바꿨습니다')
          }}
        />
      </Modal>
    </SettingRow>
  )
}

/**
 * TODO(spec): /me에 OTP 등록 여부가 없다. 모르는 동안에는 등록됐다고도 안 됐다고도 적지 않는다.
 * 등록을 마친 계정의 발급 요청을 서버가 INVALID_STATE로 거절하므로, 그때 등록됐음을 안다. 다시 등록은 서버가 받지 않는다.
 */
function OtpRow() {
  const [enrolled, setEnrolled] = useState(false)
  const [secret, setSecret] = useState<string | null>(null)
  const [code, setCode] = useState('')

  const close = () => {
    setSecret(null)
    setCode('')
  }
  const start = useMutation({
    meta: { silent: true },
    mutationFn: () => meApi.issueOtpSecret(),
    onSuccess: (data) => setSecret(data.secret ?? null),
    onError: (reason) => {
      if (reason instanceof ApiError && reason.code === 'INVALID_STATE') {
        setEnrolled(true)
        toast.info('이미 OTP를 등록했습니다')
      } else {
        toast.error(errorMessage(reason))
      }
    },
  })
  const confirm = useMutation({
    mutationFn: () => meApi.confirmOtp(code.trim()),
    onSuccess: () => {
      close()
      setEnrolled(true)
      toast.success('OTP를 등록했습니다')
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    confirm.mutate()
  }

  return (
    <SettingRow
      title="OTP"
      value={enrolled ? '등록됨' : '외부망 로그인에 필요합니다'}
      action={
        !enrolled && (
          <Button size="sm" internalOnly loading={start.isPending} onClick={() => start.mutate()}>
            OTP 등록
          </Button>
        )
      }
    >
      <Modal open={secret !== null} title="OTP 등록" onClose={close}>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="text-sm text-ink-2">
            <p>OTP 앱에 아래 비밀 키를 추가한 뒤, 앱에 표시된 6자리 번호를 입력해 주세요.</p>
            <p className="mt-2 rounded-md bg-sheet-alt px-3 py-2">
              <Mono>{secret}</Mono>
            </p>
          </div>
          <Field label="OTP 번호" hint={import.meta.env.VITE_API_BASE_URL ? undefined : '시연용 번호는 123456입니다'}>
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
          <div>
            <Button type="submit" variant="primary" disabled={code.trim().length !== 6} loading={confirm.isPending}>
              OTP 확인
            </Button>
          </div>
        </form>
      </Modal>
    </SettingRow>
  )
}

function SlackForm({ initial, onSaved }: { initial: NotificationSettings; onSaved: () => void }) {
  const refreshAll = useRefreshAll()
  const [settings, setSettings] = useState(initial)
  const save = useMutation({
    mutationFn: () => meApi.updateNotificationSettings(settings),
    onSuccess: async () => {
      toast.success('알림 설정을 저장했습니다')
      await refreshAll()
      onSaved()
    },
  })
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate()
      }}
    >
      <Field label="Slack 사용자 ID" hint="알림에는 승인 상세 링크만 담습니다.">
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
      <div>
        <Button type="submit" variant="primary" loading={save.isPending}>
          알림 설정 저장
        </Button>
      </div>
    </form>
  )
}

function SlackRow() {
  const settings = useQuery({ queryKey: ['me', 'notification-settings'], queryFn: meApi.notificationSettings })
  const [open, setOpen] = useState(false)
  // 서버에 아직 없는 API다. 빈 값이나 고장처럼 보이지 않게 그렇다고 적고 설정 버튼을 내놓지 않는다.
  if (isMissingOnServer(settings.error)) {
    return <SettingRow title="Slack 알림" value={MISSING_ON_SERVER_MESSAGE} action={null} />
  }
  return (
    <SettingRow
      title="Slack 알림"
      value={settings.data && (settings.data.slackUserId ?? '설정 안 됨')}
      action={
        <Button size="sm" aria-label="Slack 알림 설정" onClick={() => setOpen(true)}>
          설정
        </Button>
      }
    >
      <Modal open={open} title="Slack 알림" onClose={() => setOpen(false)}>
        {settings.isPending && <Spinner />}
        {settings.isError && <ErrorState error={settings.error} onRetry={() => settings.refetch()} />}
        {settings.data && <SlackForm initial={settings.data} onSaved={() => setOpen(false)} />}
      </Modal>
    </SettingRow>
  )
}

export default function MePage() {
  const me = useMe()
  const departmentName = useDepartmentNames()
  return (
    <div className="max-w-[54rem]">
      <PageHeader
        title="내 정보"
        description={`${me.name}, ${ROLE_LABEL[me.role]}, ${departmentName(me.departmentId)}, 사번 ${me.employeeNumber}`}
      />
      <div className="flex flex-col gap-4">
        <SigningKeySection me={me} />
        <Sheet flush>
          <ul className="divide-y divide-rule">
            <PasswordRow />
            <OtpRow />
            {/* 실제 서버에는 Slack 연동이 없다 (api/missingOnServer.ts). */}
            {USE_MOCK && <SlackRow />}
          </ul>
        </Sheet>
      </div>
    </div>
  )
}
