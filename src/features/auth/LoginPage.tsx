import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router'
import { authApi } from '../../api/endpoints'
import { ApiError, errorMessage } from '../../api/errors'
import { useAuth } from '../../app/AuthProvider'
import { NetworkBadge } from '../../components/badges'
import { Button, Spinner } from '../../components/ui'
import { homePath } from '../../lib/access'
import { useNetwork } from '../../lib/queries'
import { AUTH_BUTTON_CLASS, AuthField } from './AuthField'
import { AuthFrame } from './AuthFrame'

// 빌드할 때 값이 박히는 조건으로 그려서, 실제 백엔드 빌드에는 시연 계정과 비밀번호가 남지 않는다.
const DEMO_ACCOUNTS = [
  { employeeNumber: 'E1101', name: '홍길동', role: '직원, 요청자' },
  { employeeNumber: 'E1107', name: '김담당', role: 'auth-service 담당자' },
  { employeeNumber: 'E1109', name: '이담당', role: '승인 키 등록 대기' },
  { employeeNumber: 'E1001', name: '최팀장', role: '백엔드 부서 관리자' },
  { employeeNumber: 'E2001', name: '정팀장', role: '인프라 부서 관리자' },
  { employeeNumber: 'E0001', name: '박CTO', role: '관리자' },
  { employeeNumber: 'E2101', name: '오인프라', role: '승인 키 없음' },
  { employeeNumber: 'E1131', name: '강신입', role: '최초 로그인' },
]
const DEMO_PASSWORD = 'demo1234!'
const DEMO_OTP = '123456'

/**
 * 로그인과 OTP 실패는 모두 401이라 표의 "다시 로그인해 주세요"로는 무엇이 틀렸는지 모른다.
 * 비밀번호가 틀렸는지, 외부망인데 OTP를 등록하지 않았는지는 서버 문구로만 알 수 있어 그대로 보여 준다.
 */
function authErrorMessage(reason: unknown, fallback: string): string {
  if (reason instanceof ApiError && reason.code === 'UNAUTHENTICATED') return reason.serverMessage || fallback
  return errorMessage(reason)
}

export default function LoginPage() {
  const { me, booting, signIn } = useAuth()
  const network = useNetwork()
  const location = useLocation()
  const [employeeNumber, setEmployeeNumber] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [temporaryToken, setTemporaryToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const login = useMutation({
    meta: { silent: true },
    mutationFn: async () => {
      const result = await authApi.login(employeeNumber.trim(), password)
      // 값이 없을 때 조용히 멈추지 않고 알린다.
      if (result.otpRequired) {
        if (!result.temporaryToken) throw new Error('OTP 확인에 필요한 값을 받지 못했습니다. 관리자에게 알려 주세요')
        setTemporaryToken(result.temporaryToken)
        return
      }
      if (!result.accessToken) throw new Error('로그인 응답에 토큰이 없습니다. 관리자에게 알려 주세요')
      await signIn(result.accessToken)
    },
    onError: (reason) => setError(authErrorMessage(reason, '사번 또는 비밀번호가 맞지 않습니다')),
  })

  const verify = useMutation({
    meta: { silent: true },
    mutationFn: async () => {
      const { accessToken } = await authApi.verifyOtp(temporaryToken as string, otp.trim())
      await signIn(accessToken)
    },
    onError: (reason) => setError(authErrorMessage(reason, 'OTP 번호가 맞지 않습니다')),
  })

  if (me) {
    const from = (location.state as { from?: string } | null)?.from
    return <Navigate to={from ?? homePath()} replace />
  }
  if (booting && !login.isPending && !verify.isPending) return <Spinner label="세션을 확인하는 중" />

  const submitCredentials = (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    login.mutate()
  }
  const submitOtp = (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    verify.mutate()
  }

  return (
    <AuthFrame>
      <section>
        <header className="mb-6 flex items-center justify-between gap-3">
          <h1 className="text-[2.25rem] leading-tight font-bold tracking-tight">{temporaryToken === null ? '로그인' : 'OTP 확인'}</h1>
          {network === 'EXTERNAL' && <NetworkBadge network={network} />}
        </header>

        {temporaryToken === null ? (
          <form onSubmit={submitCredentials} className="flex flex-col gap-4">
            <AuthField
              label="사번"
              autoComplete="username"
              autoFocus
              value={employeeNumber}
              onChange={(e) => setEmployeeNumber(e.target.value)}
            />
            <AuthField
              label="비밀번호"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error && (
              <p className="text-base text-high" role="alert">
                {error}
              </p>
            )}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className={`mt-1 ${AUTH_BUTTON_CLASS}`}
              disabled={!employeeNumber.trim() || !password}
              loading={login.isPending}
            >
              로그인
            </Button>
            {network === 'EXTERNAL' && (
              <p className="text-base text-ink-2">외부망에서는 비밀번호 확인 뒤 OTP를 한 번 더 입력합니다.</p>
            )}
          </form>
        ) : (
          <form onSubmit={submitOtp} className="flex flex-col gap-4">
            <p className="text-base text-ink-2">외부망 접속입니다. OTP 앱에 표시된 6자리 번호를 입력해 주세요.</p>
            <AuthField
              label="OTP 번호"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              className="font-mono text-xl tracking-[0.4em]"
            />
            {error && (
              <p className="text-base text-high" role="alert">
                {error}
              </p>
            )}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className={AUTH_BUTTON_CLASS}
              disabled={otp.trim().length !== 6}
              loading={verify.isPending}
            >
              OTP 확인
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setTemporaryToken(null)
                setOtp('')
                setError(null)
              }}
            >
              처음으로 돌아가기
            </Button>
          </form>
        )}
      </section>

      {!import.meta.env.VITE_API_BASE_URL && (
        <section aria-label="시연 계정" className="border-t border-rule pt-5">
          <p className="mb-3 text-sm text-ink-2">
            시연 계정을 고르면 입력해 줍니다. 비밀번호 <code className="font-mono text-ink">{DEMO_PASSWORD}</code>, OTP{' '}
            <code className="font-mono text-ink">{DEMO_OTP}</code>
          </p>
          <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-rule bg-rule">
            {DEMO_ACCOUNTS.map((account) => {
              const picked = employeeNumber === account.employeeNumber
              return (
                <li key={account.employeeNumber} className="min-w-0">
                  <button
                    type="button"
                    className={`block h-full w-full px-3.5 py-2.5 text-left leading-snug transition-colors ${
                      picked ? 'bg-seal-soft' : 'bg-sheet hover:bg-sheet-alt'
                    }`}
                    onClick={() => {
                      setEmployeeNumber(account.employeeNumber)
                      setPassword(DEMO_PASSWORD)
                      setError(null)
                    }}
                  >
                    <span className={`block text-base font-semibold ${picked ? 'text-seal-dark' : 'text-ink'}`}>
                      {account.name} <code className="ml-0.5 font-mono text-[0.875rem] font-normal text-ink-3">{account.employeeNumber}</code>
                    </span>
                    <span className="block truncate text-[0.875rem] text-ink-2">{account.role}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </AuthFrame>
  )
}
