import { lazy, Suspense } from 'react'
import { Outlet } from 'react-router'
import { Toaster } from '../components/toast'
import { Spinner } from '../components/ui'
import { AuthProvider } from './AuthProvider'

// 환경 변수를 직접 검사해야 실제 백엔드 빌드에서 이 import가 지워져 개발 도구와 목 파일이 dist에 생기지 않는다.
const DevToolbar = import.meta.env.VITE_API_BASE_URL ? null : lazy(() => import('./DevToolbar'))

export function Root() {
  return (
    <AuthProvider>
      <Suspense fallback={<Spinner />}>
        <Outlet />
      </Suspense>
      <Toaster />
      {DevToolbar && (
        <Suspense fallback={null}>
          <DevToolbar />
        </Suspense>
      )}
    </AuthProvider>
  )
}
