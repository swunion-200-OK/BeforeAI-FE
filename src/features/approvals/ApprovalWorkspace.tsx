import { Stamp } from 'lucide-react'
import { useMemo } from 'react'
import { EmptyState } from '../../components/ui'
import { usePendingApprovals } from '../../lib/queries'
import { ApprovalDetail } from './ApprovalDetail'
import { ApprovalQueue } from './ApprovalQueue'
import { groupByRequest } from './queueGroups'

/**
 * 승인 작업공간. 왼쪽 받은편지함, 가운데 변경 내용, 오른쪽 결정 패널.
 * 칸마다 따로 스크롤해서 결정 버튼은 항상 보인다.
 */
export function ApprovalWorkspace({ requestId }: { requestId?: string }) {
  const pending = usePendingApprovals()
  const groups = useMemo(() => groupByRequest(pending.data ?? []), [pending.data])
  const nextRequestId = groups.find((group) => group.requestId !== requestId)?.requestId

  return (
    <div className="flex h-full min-h-0">
      <ApprovalQueue selectedId={requestId} />
      {requestId ? (
        // 다른 요청으로 옮겨 가면 선택·서명 진행 상태를 새로 시작한다.
        <ApprovalDetail key={requestId} requestId={requestId} nextRequestId={nextRequestId} />
      ) : (
        <div className="flex min-w-0 flex-1 items-center justify-center bg-paper">
          <div className="flex flex-col items-center">
            <span className="inline-flex size-20 -rotate-6 items-center justify-center rounded-full border-2 border-dashed border-rule-strong text-ink-3">
              <Stamp size={30} aria-hidden />
            </span>
            <EmptyState title="지금 승인할 작업이 없습니다">새 승인 요청이 오면 이 목록과 Slack으로 알려 드립니다.</EmptyState>
          </div>
        </div>
      )}
    </div>
  )
}
