import { Navigate } from 'react-router'
import { usePendingApprovals } from '../../lib/queries'
import { ApprovalWorkspace } from './ApprovalWorkspace'

/** 선택한 요청이 없으면 가장 오래 기다린 요청을 바로 연다. */
export default function PendingListPage() {
  const pending = usePendingApprovals()
  const oldest = pending.data?.[0]?.requestId
  if (oldest) return <Navigate to={`/approvals/${oldest}`} replace />
  return <ApprovalWorkspace />
}
