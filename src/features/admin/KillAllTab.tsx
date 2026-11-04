import { useQuery } from '@tanstack/react-query'
import { OctagonX } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { TaskProgress } from '../../components/rich'
import { Button, EmptyState, ErrorState, Sheet, Spinner } from '../../components/ui'
import { formatElapsed } from '../../lib/format'
import { useProjects } from '../../lib/queries'
import { runningRequestsQuery } from './adminQueries'
import { KillAllDialog } from './KillAllDialog'

/** 전사 일괄 중단 (CORE-11). 지금 무엇이 멈추는지 보고 결정하게 한다. */
export function KillAllTab() {
  const [confirming, setConfirming] = useState(false)
  const running = useQuery({ ...runningRequestsQuery, refetchInterval: 3000 })
  const projects = useProjects()
  const count = running.data?.length ?? 0
  const projectName = (id: string) => projects.data?.find((project) => project.id === id)?.name ?? id

  return (
    <>
      <Sheet
        title={running.data ? `지금 실행 중인 요청 ${count}건` : '지금 실행 중인 요청'}
        flush
        actions={
          <Button
            variant="danger"
            disabled={count === 0}
            disabledReason="실행 중인 요청이 없습니다"
            onClick={() => setConfirming(true)}
          >
            <OctagonX size={16} aria-hidden />
            전사 일괄 중단
          </Button>
        }
      >
        {running.isPending && <Spinner />}
        {running.isError && <ErrorState error={running.error} onRetry={() => running.refetch()} />}
        {running.data?.length === 0 && <EmptyState title="실행 중인 요청이 없습니다" />}
        {running.data && running.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="sheet-table [&_td]:py-3">
              <thead>
                <tr>
                  <th>요청</th>
                  <th>요청자</th>
                  <th>진행</th>
                  <th>요청 후 경과</th>
                </tr>
              </thead>
              <tbody>
                {running.data.map((request) => (
                  <tr key={request.id}>
                    <td>
                      <Link to={`/requests/${request.id}`} className="font-medium text-ink hover:text-seal hover:underline">
                        {request.prompt}
                      </Link>
                      <p className="mt-0.5 text-[0.875rem] text-ink-3">{projectName(request.projectId)}</p>
                    </td>
                    <td className="whitespace-nowrap">{request.requester.name}</td>
                    <td>{request.taskSummary ? <TaskProgress summary={request.taskSummary} /> : '-'}</td>
                    <td className="whitespace-nowrap text-ink-2">{formatElapsed(request.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Sheet>

      <KillAllDialog open={confirming} onClose={() => setConfirming(false)} />
    </>
  )
}
