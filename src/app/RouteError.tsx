import { RefreshCw } from 'lucide-react'
import { useEffect } from 'react'
import { useLocation, useRouteError } from 'react-router'
import { Button, EmptyState } from '../components/ui'

const RELOADED_PATH_KEY = 'beforeai.reloaded-path'

/** 화면 코드를 받지 못한 경우. 새 버전이 나온 뒤 열어 둔 탭이나 서버 재시작 직후에 생기며, 새로고침하면 풀린다. */
function isPageLoadError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /dynamically imported module|importing a module script failed/i.test(error.message)
  )
}

function alreadyReloaded(path: string): boolean {
  try {
    if (sessionStorage.getItem(RELOADED_PATH_KEY) === path) return true
    sessionStorage.setItem(RELOADED_PATH_KEY, path)
    return false
  } catch {
    // 저장소를 못 쓰면 새로고침이 반복될 수 있으므로 자동으로 하지 않는다.
    return true
  }
}

/** 화면 하나가 잘못돼도 앱 전체가 멈추지 않게 그 자리에 안내를 띄운다. */
export function RouteError() {
  const error = useRouteError()
  const { pathname } = useLocation()
  const pageLoadError = isPageLoadError(error)

  useEffect(() => {
    if (pageLoadError && !alreadyReloaded(pathname)) window.location.reload()
  }, [pageLoadError, pathname])

  return (
    <div className="flex min-h-[60dvh] items-center justify-center">
      <EmptyState
        title="이 화면을 열지 못했습니다"
        action={
          <Button variant="primary" onClick={() => window.location.reload()}>
            <RefreshCw size={16} aria-hidden />
            새로고침
          </Button>
        }
      >
        {pageLoadError
          ? '새 버전이 나왔거나 연결이 잠시 끊겼을 수 있습니다. 새로고침해 주세요.'
          : '새로고침해도 같으면 아래 오류 내용을 담당자에게 전달해 주세요.'}
        {!pageLoadError && error instanceof Error && (
          <span className="mt-2 block font-mono text-xs break-all text-ink-3">{error.message}</span>
        )}
      </EmptyState>
    </div>
  )
}
