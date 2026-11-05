import { ArrowLeft } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router'
import { EmptyState } from '../../components/ui'
import { usePendingApprovals } from '../../lib/queries'
import { ApprovalDetail } from './ApprovalDetail'
import { ApprovalQueue } from './ApprovalQueue'
import { groupByRequest } from './queueGroups'

/**
 * 승인 작업공간. 왼쪽 목록, 가운데 변경 내용, 오른쪽 결정.
 * 칸마다 따로 스크롤해서 결정 버튼은 항상 보인다.
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
        <EmptyState title="지금 승인할 작업이 없습니다">새 요청이 승인 대기에 들어오면 여기에 표시됩니다.</EmptyState>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col xl:flex-row">
      <div className={requestId ? 'hidden xl:flex' : 'flex'}>
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
