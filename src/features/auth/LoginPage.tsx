import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router'
import { USE_MOCK } from '../../api/client'
import { authApi } from '../../api/endpoints'
import { errorMessage } from '../../api/errors'
import { useAuth } from '../../app/AuthProvider'
import { NetworkBadge } from '../../components/badges'
import { Avatar } from '../../components/rich'
import { Button, Spinner } from '../../components/ui'
import { homePath } from '../../lib/access'
import { useNetwork } from '../../lib/queries'
import { AUTH_BUTTON_CLASS, AuthField } from './AuthField'
import { AuthFrame } from './AuthFrame'

const DEMO_ACCOUNTS = [
  { employeeNo: 'E1101', name: '홍길동', role: '직원, 요청자' },
  { employeeNo: 'E1107', name: '김담당', role: 'auth-service 담당자' },
  { employeeNo: 'E1109', name: '이담당', role: '승인 키 등록 대기' },
  { employeeNo: 'E1001', name: '최팀장', role: '백엔드 부서 관리자' },
  { employeeNo: 'E2001', name: '정팀장', role: '인프라 부서 관리자' },
  { employeeNo: 'E0001', name: '박CTO', role: '관리자' },
  { employeeNo: 'E1131', name: '강신입', role: '최초 로그인' },
]
const DEMO_PASSWORD = 'demo1234!'
const DEMO_OTP = '123456'

export default function LoginPage() {
  const { me, booting, signIn } = useAuth()
  const network = useNetwork()
  const location = useLocation()
  const [employeeNo, setEmployeeNo] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [tempToken, setTempToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const login = useMutation({
    meta: { silent: true },
    mutationFn: async () => {
      const result = await authApi.login(employeeNo.trim(), password)
      if (result.otpRequired) {
        setTempToken(result.tempToken ?? null)
        return
      }
      await signIn(result.accessToken as string)
    },
    onError: (reason) => setError(errorMessage(reason)),
  })

  const verify = useMutation({
    meta: { silent: true },
    mutationFn: async () => {
      const { accessToken } = await authApi.verifyOtp(tempToken as string, otp.trim())
      await signIn(accessToken)
    },
    onError: (reason) => setError(errorMessage(reason)),
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
      <section className="rounded-2xl border border-rule bg-sheet p-8 shadow-card">
        <header className="mb-6 flex items-center justify-between gap-3">
          <h1 className="text-[2rem] leading-tight font-bold tracking-tight">{tempToken === null ? '로그인' : 'OTP 확인'}</h1>
          <NetworkBadge network={network} />
        </header>

        {tempToken === null ? (
          <form onSubmit={submitCredentials} className="flex flex-col gap-4">
            <AuthField
              label="사번"
              autoComplete="username"
              autoFocus
              value={employeeNo}
              onChange={(e) => setEmployeeNo(e.target.value)}
            />
            <AuthField
              label="비밀번호"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error && (
              <p className="text-[0.9375rem] text-high" role="alert">
                {error}
              </p>
            )}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className={`mt-1 ${AUTH_BUTTON_CLASS}`}
              disabled={!employeeNo.trim() || !password}
              loading={login.isPending}
            >
              로그인
            </Button>
            {network === 'EXTERNAL' && (
              <p className="text-[0.9375rem] text-ink-2">외부망에서는 비밀번호 확인 뒤 OTP를 한 번 더 입력합니다.</p>
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
              <p className="text-[0.9375rem] text-high" role="alert">
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
                setTempToken(null)
                setOtp('')
                setError(null)
              }}
            >
              처음으로 돌아가기
            </Button>
          </form>
        )}
      </section>

      {USE_MOCK && (
        <section aria-label="시연 계정">
          <p className="mb-2 text-[0.9375rem] text-ink-2">
            시연 계정을 고르면 입력해 줍니다. 비밀번호 <code className="font-mono text-ink">{DEMO_PASSWORD}</code>, OTP{' '}
            <code className="font-mono text-ink">{DEMO_OTP}</code>
          </p>
          <ul className="grid grid-cols-2 gap-2">
            {DEMO_ACCOUNTS.map((account) => (
              <li key={account.employeeNo}>
                <button
                  type="button"
                  className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors hover:border-seal/50 hover:bg-seal-soft/40 ${
                    employeeNo === account.employeeNo ? 'border-seal bg-seal-soft' : 'border-rule bg-sheet'
                  }`}
                  onClick={() => {
                    setEmployeeNo(account.employeeNo)
                    setPassword(DEMO_PASSWORD)
                    setError(null)
                  }}
                >
                  <Avatar name={account.name} />
                  <span className="min-w-0 leading-snug">
                    <span className="block text-[0.9375rem] font-semibold text-ink">
                      {account.name} <code className="ml-0.5 font-mono text-[0.8125rem] font-normal text-ink-3">{account.employeeNo}</code>
                    </span>
                    <span className="block truncate text-[0.8125rem] text-ink-2">{account.role}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </AuthFrame>
  )
}
