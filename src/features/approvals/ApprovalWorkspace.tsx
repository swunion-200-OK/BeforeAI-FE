import { ArrowLeft } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router'
import { USE_MOCK } from '../../api/client'
import { EmptyState } from '../../components/ui'
import { usePendingApprovals } from '../../lib/queries'
import { ApprovalDetail } from './ApprovalDetail'
import { ApprovalQueue } from './ApprovalQueue'
import { groupByRequest } from './queueGroups'

/**
 * 승인 작업공간. 넓은 화면은 세 칸을 각각 스크롤하고, 좁은 화면은 상세 내용을 한 번에 스크롤한다.
 * 좁은 화면에서도 결정 영역은 아래에 남긴다.
 */
export function ApprovalWorkspace({ requestId }: { requestId?: string }) {
  const pending = usePendingApprovals()
  const groups = useMemo(() => groupByRequest(pending.data ?? []), [pending.data])
  const nextRequestId = groups.find((group) => group.requestId !== requestId)?.requestId

  // 볼 요청도 기다리는 요청도 없으면 칸을 나누지 않고 빈 상태 하나만 보여 준다.
  if (!requestId && pending.isSuccess && groups.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-paper">
        <h1 className="sr-only">승인 대기</h1>
        {/* 배포된 서버에는 Slack 알림이 없다. 목에서만 알림이 간다고 말한다. */}
        <EmptyState title="지금 승인할 작업이 없습니다">
          {USE_MOCK ? '새 승인 요청이 오면 Slack으로 알려 드립니다.' : '새 승인 요청이 승인 대기에 들어오면 여기에 표시됩니다.'}
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col xl:flex-row">
      <div className={requestId ? 'hidden xl:flex' : 'flex min-h-0 flex-1 xl:flex-none'}>
        <ApprovalQueue selectedId={requestId} />
      </div>
      {requestId ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-rule bg-sheet px-4 py-2 xl:hidden">
            <Link to="/approvals?queue=1" className="inline-flex min-h-10 items-center gap-2 rounded-md pr-2 text-sm font-medium text-ink-2 hover:text-ink">
              <ArrowLeft size={17} aria-hidden />
              승인 대기 목록
            </Link>
          </div>
          {/* 다른 요청으로 옮겨 가면 선택·서명 진행 상태를 새로 시작한다. */}
          <ApprovalDetail key={requestId} requestId={requestId} nextRequestId={nextRequestId}
            otherCount={groups.filter((g) => g.requestId !== requestId).length}
          />
        </div>
      ) : (
        <div className="hidden min-w-0 flex-1 bg-paper xl:block" />
      )}
    </div>
  )
}
