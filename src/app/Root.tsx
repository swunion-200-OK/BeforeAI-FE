import { lazy, Suspense } from 'react'
import { Outlet } from 'react-router'
import { USE_MOCK } from '../api/client'
import { Toaster } from '../components/toast'
import { Spinner } from '../components/ui'
import { AuthProvider } from './AuthProvider'

const DevToolbar = lazy(() => import('./DevToolbar'))

export function Root() {
  return (
    <AuthProvider>
      <Suspense fallback={<Spinner />}>
        <Outlet />
      </Suspense>
      <Toaster />
      {USE_MOCK && (
        <Suspense fallback={null}>
          <DevToolbar />
        </Suspense>
      )}
    </AuthProvider>
  )
}
