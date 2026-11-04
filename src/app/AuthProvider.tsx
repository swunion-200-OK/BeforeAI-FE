import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { networkStore, setAccessToken, setSessionExpiredHandler } from '../api/client'
import { authApi, meApi } from '../api/endpoints'
import type { Me } from '../api/types'

interface AuthValue {
  /** 로그인 전이면 null */
  me: Me | null
  booting: boolean
  /** 사용자가 직접 로그아웃한 상태 */
  signedOut: boolean
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
  useEffect(() => {
    let cancelled = false
    setSessionExpiredHandler(clearSession)
    authApi
      .refresh()
      .then(({ accessToken }) => {
        if (cancelled) return
        setAccessToken(accessToken)
        setAuthenticated(true)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setBooting(false)
      })
    return () => {
      cancelled = true
    }
  }, [clearSession])

  const signIn = useCallback(
    async (accessToken: string) => {
      setAccessToken(accessToken)
      const me = await meApi.get()
      client.setQueryData(['me'], me)
      // clear()는 구독 중인 화면에 알리지 않아 이전 사용자의 데이터가 남는다. reset은 알리고 다시 읽는다.
      await client.cancelQueries({ predicate: (query) => query.queryKey[0] !== 'me' })
      void client.resetQueries({ predicate: (query) => query.queryKey[0] !== 'me' })
      setSignedOut(false)
      setAuthenticated(true)
    },
    [client],
  )

  const signOut = useCallback(async () => {
    await authApi.logout().catch(() => {})
    setSignedOut(true)
    clearSession()
  }, [clearSession])

  const value = useMemo<AuthValue>(
    () => ({
      me: authenticated ? (meQuery.data ?? null) : null,
      booting: booting || (authenticated && meQuery.isPending),
      signedOut,
      signIn,
      signOut,
    }),
    [authenticated, meQuery.data, meQuery.isPending, booting, signedOut, signIn, signOut],
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
