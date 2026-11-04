import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { setAccessToken, setSessionExpiredHandler } from '../api/client'
import { authApi, meApi } from '../api/endpoints'
import type { Me } from '../api/types'

interface AuthValue {
  /** 로그인 전이면 null */
  me: Me | null
  booting: boolean
  /** 토큰을 받은 뒤 부른다 (로그인, OTP 확인, 개발용 사용자 전환) */
  signIn: (accessToken: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient()
  const [booting, setBooting] = useState(true)
  const [authenticated, setAuthenticated] = useState(false)

  const meQuery = useQuery({ queryKey: ['me'], queryFn: meApi.get, enabled: authenticated, staleTime: 5_000 })

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
      client.clear()
      setAuthenticated(true)
      await client.fetchQuery({ queryKey: ['me'], queryFn: meApi.get })
    },
    [client],
  )

  const signOut = useCallback(async () => {
    await authApi.logout().catch(() => {})
    clearSession()
  }, [clearSession])

  const value = useMemo<AuthValue>(
    () => ({
      me: authenticated ? (meQuery.data ?? null) : null,
      booting: booting || (authenticated && meQuery.isPending),
      signIn,
      signOut,
    }),
    [authenticated, meQuery.data, meQuery.isPending, booting, signIn, signOut],
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
