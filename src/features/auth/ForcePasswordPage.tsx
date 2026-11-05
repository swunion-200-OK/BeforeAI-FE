import { useQueryClient } from '@tanstack/react-query'
import { useAuth, useMe } from '../../app/AuthProvider'
import { NetworkBadge } from '../../components/badges'
import { toast } from '../../components/toast'
import { Banner, Button } from '../../components/ui'
import { useNetwork } from '../../lib/queries'
import { AuthFrame } from './AuthFrame'
import { PasswordForm } from './PasswordForm'

/** 최초 로그인이면 비밀번호를 바꿔야 다른 화면으로 갈 수 있다. */
export function ForcePasswordPage() {
  const me = useMe()
  const { signOut } = useAuth()
  const network = useNetwork()
  const client = useQueryClient()
  return (
    <AuthFrame>
      <section>
        <header className="mb-3 flex items-center justify-between gap-3">
          <h1 className="text-[2.25rem] leading-tight font-bold tracking-tight">비밀번호를 바꿔 주세요</h1>
          {network === 'EXTERNAL' && <NetworkBadge network={network} />}
        </header>
        <p className="mb-5 text-base text-ink-2">
          {me.name}님은 처음 로그인했습니다. 관리자가 발급한 초기 비밀번호를 바꿔야 서비스를 쓸 수 있습니다.
        </p>
        {network === 'EXTERNAL' && (
          <div className="mb-5">
            <Banner tone="warning" title="내부망에서만 바꿀 수 있습니다">
              회사 네트워크나 Tailscale에 연결한 뒤 다시 로그인해 주세요.
            </Banner>
          </div>
        )}
        <PasswordForm
          large
          submitLabel="비밀번호 바꾸기"
          onDone={async () => {
            toast.success('비밀번호를 바꿨습니다')
            await client.invalidateQueries({ queryKey: ['me'] })
          }}
        />
      </section>
      <div>
        <Button variant="ghost" className="-ml-4" onClick={() => signOut()}>
          로그아웃
        </Button>
      </div>
    </AuthFrame>
  )
}
