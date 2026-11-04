import { Navigate } from 'react-router'
import { usePendingApprovals } from '../../lib/queries'
import { ApprovalWorkspace } from './ApprovalWorkspace'

/**
 * 선택한 요청이 없으면 가장 오래 기다린 요청을 바로 연다.
 * 캐시에는 서명했거나 다른 사람이 처리해 이미 빠진 요청이 남아 있을 수 있고, 한 번 옮겨 가면 되돌리지 않는다.
 * 그래서 이 화면에 들어온 뒤 새로 받은 목록으로만 고른다.
 */
export default function PendingListPage() {
  const pending = usePendingApprovals()
  const oldest = pending.isSuccess && pending.isFetchedAfterMount ? pending.data[0]?.requestId : undefined
  if (oldest) return <Navigate to={`/approvals/${oldest}`} replace />
  return <ApprovalWorkspace />
}
