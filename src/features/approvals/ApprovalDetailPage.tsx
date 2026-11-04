import { useParams } from 'react-router'
import { ApprovalWorkspace } from './ApprovalWorkspace'

export default function ApprovalDetailPage() {
  const { requestId } = useParams()
  if (!requestId) return null
  return <ApprovalWorkspace requestId={requestId} />
}
