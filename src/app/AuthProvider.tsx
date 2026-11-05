import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  isSessionUnreachable,
  logout,
  networkStore,
  restoreSession,
  retryRestoreSession,
  SESSION_UNREACHABLE_MESSAGE,
  setAccessToken,
  setSessionExpiredHandler,
} from '../api/client'
import { meApi } from '../api/endpoints'
import type { Me } from '../api/types'
import { toast } from '../components/toast'

interface AuthValue {
  /** 로그인 전이면 null */
  me: Me | null
  booting: boolean
  /** 사용자가 직접 로그아웃한 상태 */
  signedOut: boolean
  /** 세션이 끊겼는지 알 수 없거나, 살아 있는데 내 정보를 못 읽은 상태. 로그인 화면으로 보내지 않고 다시 시도하게 한다 */
  sessionError: Error | null
  retrySession: () => void
  /** 토큰을 받은 뒤 부른다 (로그인, OTP 확인, 개발용 사용자 전환) */
  signIn: (accessToken: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient()
  const [booting, setBooting] = useState(true)
  const [authenticated, setAuthenticated] = useState(false)
  const [signedOut, setSignedOut] = useState(false)
  const [unreachable, setUnreachable] = useState(false)

  const meQuery = useQuery({ queryKey: ['me'], queryFn: meApi.get, enabled: authenticated, staleTime: 5_000 })

  // X-Network 헤더를 읽을 수 없는 환경(CORS 미노출 등)에서도 /me 값으로 망을 맞춘다.
  const serverNetwork = meQuery.data?.network
  useEffect(() => {
    if (serverNetwork) networkStore.set(serverNetwork)
  }, [serverNetwork])

  const clearSession = useCallback(() => {
    setAccessToken(null)
    setAuthenticated(false)
    client.clear()
  }, [client])

  // 새로고침해도 세션을 잇는다: 액세스 토큰은 메모리에만 두고, 리프레시 쿠키로 다시 받는다.
  // 서버가 거부하면 알리지 않고 로그인 화면으로 넘어간다. 원래 주소는 RequireAuth가 들고 간다.
  // 서버에 닿지 못했으면 세션이 살아 있을 수 있어 RequireAuth가 다시 시도할 화면을 보여 준다.
  useEffect(() => {
    let cancelled = false
    setSessionExpiredHandler(() => {
      clearSession()
      toast.error('세션이 만료되었습니다. 다시 로그인해 주세요')
    })
    void restoreSession().then((restored) => {
      if (cancelled) return
      setAuthenticated(restored)
      setUnreachable(isSessionUnreachable())
      setBooting(false)
    })
    return () => {
      cancelled = true
    }
  }, [clearSession])

  const signIn = useCallback(
    async (accessToken: string) => {
      setAccessToken(accessToken)
      let me: Me
      try {
        me = await meApi.get()
      } catch (reason) {
        // 로그인이 끝나지 않았으니 토큰을 남기지 않는다.
        setAccessToken(null)
        throw reason
      }
      client.setQueryData(['me'], me)
      // clear()는 구독 중인 화면에 알리지 않아 이전 사용자의 데이터가 남는다. reset은 알리고 다시 읽는다.
      await client.cancelQueries({ predicate: (query) => query.queryKey[0] !== 'me' })
      void client.resetQueries({ predicate: (query) => query.queryKey[0] !== 'me' })
      setSignedOut(false)
      setUnreachable(false)
      setAuthenticated(true)
    },
    [client],
  )

  const signOut = useCallback(async () => {
    // 서버가 쿠키를 지우지 못하면 새로고침할 때 세션이 되살아난다. 숨기지 않고 알린다.
    await logout().catch(() => toast.error('서버에 연결하지 못해 로그아웃이 끝나지 않았을 수 있습니다. 다시 시도해 주세요'))
    setSignedOut(true)
    clearSession()
  }, [clearSession])

  const { refetch: refetchMe } = meQuery
  const retrySession = useCallback(() => {
    if (!unreachable) {
      void refetchMe()
      return
    }
    setBooting(true)
    void retryRestoreSession().then((restored) => {
      setAuthenticated(restored)
      setUnreachable(isSessionUnreachable())
      setBooting(false)
    })
  }, [refetchMe, unreachable])
  const sessionError = useMemo(() => {
    if (unreachable) return new Error(SESSION_UNREACHABLE_MESSAGE)
    return authenticated && !meQuery.data ? meQuery.error : null
  }, [unreachable, authenticated, meQuery.data, meQuery.error])

  const value = useMemo<AuthValue>(
    () => ({
      me: authenticated ? (meQuery.data ?? null) : null,
      booting: booting || (authenticated && meQuery.isPending),
      signedOut,
      sessionError,
      retrySession,
      signIn,
      signOut,
    }),
    [authenticated, meQuery.data, meQuery.isPending, booting, signedOut, sessionError, retrySession, signIn, signOut],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('AuthProvider 안에서만 쓸 수 있습니다')
  return value
}

/** 로그인이 끝난 화면에서 쓴다. */
export function useMe(): Me {
  const { me } = useAuth()
  if (!me) throw new Error('로그인 후에만 쓸 수 있습니다')
  return me
}
