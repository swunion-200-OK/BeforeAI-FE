import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { isTransientError, setTransport } from './api/client'
import { ApiError, errorMessage } from './api/errors'
import { isMissingOnServer } from './api/missingOnServer'
import { toast } from './components/toast'
import './index.css'

async function bootstrap() {
  const { signingService } = await import('./crypto/signingService')
  try {
    await signingService.initialize()
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 저장소 오류입니다.'
    createRoot(document.getElementById('root')!).render(
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-3 p-6 text-ink">
        <h1 className="text-xl font-semibold">승인 키 저장소를 준비하지 못했습니다</h1>
        <p role="alert" className="text-sm text-ink-2">{message}</p>
        <p className="text-sm text-ink-2">기존 개인키를 안전하게 옮기지 못한 상태입니다. 저장 공간을 확인한 뒤 새로고침해 주세요. 문제가 계속되면 브라우저 저장 데이터를 임의로 공유하지 말고 관리자에게 문의해 주세요.</p>
      </main>,
    )
    return
  }

  // 실제 백엔드를 쓰면(VITE_API_BASE_URL) 목 코드는 번들에 불러오지 않는다.
  // 환경 변수를 직접 검사해야 빌드할 때 이 import가 지워져 목 파일이 dist에 생기지 않는다.
  if (!import.meta.env.VITE_API_BASE_URL) {
    const { mockFetch, initMock } = await import('./api/mock')
    await initMock()
    setTransport(mockFetch)
  }

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // 서버가 코드로 답한 오류는 다시 보내도 같다. 쓰기 요청은 여기서 다시 보내지 않는다 (react-query 기본값).
        retry: (count, error) => count < 2 && (!(error instanceof ApiError) || isTransientError(error)),
        // 서버에 없는 API는 창을 오갈 때마다 다시 물어볼 이유가 없다.
        refetchOnWindowFocus: (query) => !isMissingOnServer(query.state.error),
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
