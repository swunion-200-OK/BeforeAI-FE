import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router'
import { USE_MOCK } from '../../api/client'
import { authApi } from '../../api/endpoints'
import { errorMessage } from '../../api/errors'
import { useAuth } from '../../app/AuthProvider'
import { NetworkBadge } from '../../components/badges'
import { Button, Field, Spinner, TextInput } from '../../components/ui'
import { homePath } from '../../lib/access'
import { useNetwork } from '../../lib/queries'

const DEMO_ACCOUNTS = [
  { employeeNo: 'E1101', label: '홍길동, 직원(요청자)' },
  { employeeNo: 'E1107', label: '김담당, auth-service 담당자' },
  { employeeNo: 'E1109', label: '이담당, 승인 키 등록 대기' },
  { employeeNo: 'E1001', label: '최팀장, 백엔드 부서 관리자' },
  { employeeNo: 'E2001', label: '정팀장, 인프라 부서 관리자' },
  { employeeNo: 'E0001', label: '박CTO, 관리자' },
  { employeeNo: 'E1131', label: '강신입, 최초 로그인' },
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
    return <Navigate to={from ?? homePath(network)} replace />
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
    <div className="flex min-h-dvh flex-col">
      <div className={`h-1.5 shrink-0 ${network === 'EXTERNAL' ? 'band-external' : 'bg-internal'}`} role="presentation" />
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-5 px-4 py-10">
        <section className="rounded-md border border-rule-strong bg-sheet">
          <header className="flex items-center justify-between gap-3 border-b border-rule-strong px-5 py-4">
            <h1 className="text-lg">AI 작업 승인</h1>
            <NetworkBadge network={network} />
          </header>

          {tempToken === null ? (
            <form onSubmit={submitCredentials} className="flex flex-col gap-3 p-5">
              <Field label="사번">
                {(id) => (
                  <TextInput
                    id={id}
                    autoComplete="username"
                    autoFocus
                    value={employeeNo}
                    onChange={(e) => setEmployeeNo(e.target.value)}
                  />
                )}
              </Field>
              <Field label="비밀번호">
                {(id) => (
                  <TextInput
                    id={id}
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                )}
              </Field>
              {error && (
                <p className="text-sm text-high" role="alert">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="mt-1 w-full"
                disabled={!employeeNo.trim() || !password}
                loading={login.isPending}
              >
                로그인
              </Button>
              {network === 'EXTERNAL' && (
                <p className="text-xs text-ink-3">외부망에서는 비밀번호 확인 뒤 OTP를 한 번 더 입력합니다.</p>
              )}
            </form>
          ) : (
            <form onSubmit={submitOtp} className="flex flex-col gap-3 p-5">
              <p className="text-sm text-ink-2">외부망 접속입니다. OTP 앱에 표시된 6자리 번호를 입력해 주세요.</p>
              <Field label="OTP 번호">
                {(id) => (
                  <TextInput
                    id={id}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    autoFocus
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    className="font-mono tracking-widest"
                  />
                )}
              </Field>
              {error && (
                <p className="text-sm text-high" role="alert">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="w-full"
                disabled={otp.trim().length !== 6}
                loading={verify.isPending}
              >
                OTP 확인
              </Button>
              <Button
                variant="ghost"
                size="sm"
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
          <section aria-label="시연 계정" className="text-xs text-ink-2">
            <p className="mb-1.5">
              시연 계정을 고르면 입력해 줍니다. 비밀번호 <code className="font-mono">{DEMO_PASSWORD}</code>, OTP{' '}
              <code className="font-mono">{DEMO_OTP}</code>
            </p>
            <ul className="flex flex-col gap-0.5">
              {DEMO_ACCOUNTS.map((account) => (
                <li key={account.employeeNo}>
                  <button
                    type="button"
                    className="w-full rounded px-1.5 py-0.5 text-left hover:bg-sheet"
                    onClick={() => {
                      setEmployeeNo(account.employeeNo)
                      setPassword(DEMO_PASSWORD)
                      setError(null)
                    }}
                  >
                    <code className="mr-2 font-mono text-ink">{account.employeeNo}</code>
                    {account.label}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  )
}
