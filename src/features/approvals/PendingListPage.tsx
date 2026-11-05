import { Navigate, useSearchParams } from 'react-router'
import { usePendingApprovals } from '../../lib/queries'
import { ApprovalWorkspace } from './ApprovalWorkspace'
import { groupByRequest } from './queueGroups'

/**
 * 기본 진입은 가장 오래 기다린 요청을 바로 연다. 모바일의 목록 복귀는 queue=1로 자동 선택을 멈춘다.
 * 캐시에는 서명했거나 다른 사람이 처리해 이미 빠진 요청이 남아 있을 수 있고, 한 번 옮겨 가면 되돌리지 않는다.
 * 그래서 이 화면에 들어온 뒤 새로 받은 목록으로만 고른다.
 */
export default function PendingListPage() {
  const [searchParams] = useSearchParams()
  const pending = usePendingApprovals()
  const oldest = pending.isSuccess && pending.isFetchedAfterMount ? groupByRequest(pending.data)[0]?.requestId : undefined
  if (oldest && searchParams.get('queue') !== '1') return <Navigate to={`/approvals/${oldest}`} replace />
  return <ApprovalWorkspace />
}
