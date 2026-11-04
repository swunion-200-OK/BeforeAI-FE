import { useMemo } from 'react'
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
        <EmptyState title="지금 승인할 작업이 없습니다">새 승인 요청이 오면 Slack으로 알려 드립니다.</EmptyState>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      <ApprovalQueue selectedId={requestId} />
      {requestId ? (
        // 다른 요청으로 옮겨 가면 선택·서명 진행 상태를 새로 시작한다.
        <ApprovalDetail key={requestId} requestId={requestId} nextRequestId={nextRequestId}
          otherCount={groups.filter((g) => g.requestId !== requestId).length}
        />
      ) : (
        <div className="min-w-0 flex-1 bg-paper" />
      )}
    </div>
  )
}
