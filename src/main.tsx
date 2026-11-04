import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { setTransport, USE_MOCK } from './api/client'
import { ApiError, errorMessage } from './api/errors'
import { toast } from './components/toast'
import './index.css'

async function bootstrap() {
  // 실제 백엔드를 쓰면(VITE_API_BASE_URL) 목 코드는 번들에 불러오지 않는다.
  if (USE_MOCK) {
    const { mockFetch, initMock } = await import('./api/mock')
    initMock()
    setTransport(mockFetch)
  }

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: (count, error) => !(error instanceof ApiError) && count < 2,
      },
    },
    queryCache: new QueryCache({
      onError: (error) => {
        // 조회 실패는 각 화면이 보여 준다. 내부망 안내만 토스트로 알린다 (3.2).
        if (error instanceof ApiError && error.code === 'INTERNAL_NETWORK_ONLY') toast.error(error.message)
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        // 화면에서 직접 처리하는 오류는 meta.silent를 준다.
        if (!mutation.meta?.silent) toast.error(errorMessage(error))
      },
    }),
  })

  const { router } = await import('./app/routes')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  )
}

void bootstrap()
