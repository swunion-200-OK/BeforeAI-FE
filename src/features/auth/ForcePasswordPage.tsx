import { useQueryClient } from '@tanstack/react-query'
import { useAuth, useMe } from '../../app/AuthProvider'
import { NetworkBadge } from '../../components/badges'
import { toast } from '../../components/toast'
import { Banner, Button, Sheet } from '../../components/ui'
import { useNetwork } from '../../lib/queries'
import { PasswordForm } from './PasswordForm'

/** 최초 로그인이면 비밀번호를 바꿔야 다른 화면으로 갈 수 있다. */
export function ForcePasswordPage() {
  const me = useMe()
  const { signOut } = useAuth()
  const network = useNetwork()
  const client = useQueryClient()
  return (
    <div className="flex min-h-dvh flex-col">
      <div className={`h-1.5 shrink-0 ${network === 'EXTERNAL' ? 'band-external' : 'bg-internal'}`} role="presentation" />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4 py-10">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-[1.375rem]">비밀번호를 바꿔 주세요</h1>
          <NetworkBadge network={network} />
        </div>
        <p className="text-sm text-ink-2">
          {me.name}님은 처음 로그인했습니다. 관리자가 발급한 초기 비밀번호를 바꿔야 서비스를 쓸 수 있습니다.
        </p>
        {network === 'EXTERNAL' && (
          <Banner tone="warning" title="내부망에서만 바꿀 수 있습니다">
            회사 네트워크나 Tailscale에 연결한 뒤 다시 로그인해 주세요.
          </Banner>
        )}
        <Sheet>
          <PasswordForm
            submitLabel="비밀번호 바꾸기"
            onDone={async () => {
              toast.success('비밀번호를 바꿨습니다')
              await client.invalidateQueries({ queryKey: ['me'] })
            }}
          />
        </Sheet>
        <div>
          <Button variant="ghost" size="sm" onClick={() => signOut()}>
            로그아웃
          </Button>
        </div>
      </main>
    </div>
  )
}
