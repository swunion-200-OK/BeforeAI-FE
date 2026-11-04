import { ShieldAlert } from 'lucide-react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { INTERNAL_ONLY_MESSAGE } from '../api/errors'
import type { Role } from '../api/types'
import { Spinner } from '../components/ui'
import { ForcePasswordPage } from '../features/auth/ForcePasswordPage'
import { homePath } from '../lib/access'
import { useIsExternal, useNetwork } from '../lib/queries'
import { useAuth } from './AuthProvider'

export function RequireAuth() {
  const { me, booting } = useAuth()
  const location = useLocation()
  if (booting) return <Spinner label="세션을 확인하는 중" />
  if (!me) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }
  if (me.mustChangePassword) return <ForcePasswordPage />
  return <Outlet />
}

function BlockedPanel({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-20 text-center">
      <ShieldAlert size={28} className="text-external" aria-hidden />
      <p className="font-medium text-ink">{message}</p>
    </div>
  )
}

/** 주소를 직접 입력해 들어와도 외부망이면 내부망 전용 화면을 막는다. */
export function RequireInternal() {
  return useIsExternal() ? <BlockedPanel message={INTERNAL_ONLY_MESSAGE} /> : <Outlet />
}

export function RequireRole({ roles }: { roles: Role[] }) {
  const { me } = useAuth()
  return me && roles.includes(me.role) ? <Outlet /> : <BlockedPanel message="권한이 없습니다" />
}

export function HomeRedirect() {
  return <Navigate to={homePath(useNetwork())} replace />
}
