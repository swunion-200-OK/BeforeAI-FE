import { useQuery } from '@tanstack/react-query'
import { Activity, FileClock, OctagonX, SkipForward, Undo2, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { ProjectTag, TaskProgress, UserChip } from '../../components/rich'
import { Button, EmptyState, ErrorState, Sheet, Spinner } from '../../components/ui'
import { formatElapsed } from '../../lib/format'
import { useProjects } from '../../lib/queries'
import { runningRequestsQuery } from './adminQueries'
import { KillAllDialog } from './KillAllDialog'

const CONSEQUENCES: Array<{ icon: LucideIcon; text: string }> = [
  { icon: OctagonX, text: '실행 중인 모든 요청을 즉시 멈춥니다. 서명 없이 바로 동작합니다.' },
  { icon: SkipForward, text: '아직 시작하지 않은 작업은 실행하지 않습니다.' },
  { icon: Undo2, text: '이미 성공한 코드 작업은 되돌리지 않습니다.' },
  { icon: FileClock, text: '누가 왜 멈췄는지 감사 로그에 남습니다.' },
]

/** 전사 일괄 중단 (CORE-11). 지금 무엇이 멈추는지 보고 결정하게 한다. */
export function KillAllTab() {
  const [confirming, setConfirming] = useState(false)
  const running = useQuery({ ...runningRequestsQuery, refetchInterval: 3000 })
  const projects = useProjects()
  const count = running.data?.length ?? 0
  const projectName = (id: string) => projects.data?.find((project) => project.id === id)?.name ?? id

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <Sheet
        title={running.data ? `지금 실행 중인 요청 ${count}건` : '지금 실행 중인 요청'}
        icon={<Activity size={16} aria-hidden />}
        flush
      >
        {running.isPending && <Spinner />}
        {running.isError && <ErrorState error={running.error} onRetry={() => running.refetch()} />}
        {running.data?.length === 0 && (
          <EmptyState title="실행 중인 요청이 없습니다">멈출 작업이 없습니다. 실행이 시작되면 여기에 바로 나타납니다.</EmptyState>
        )}
        {running.data && running.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="sheet-table">
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
                      <Link to={`/requests/${request.id}`} className="font-medium text-seal hover:underline">
                        {request.prompt}
                      </Link>
                      <div className="mt-0.5">
                        <ProjectTag name={projectName(request.projectId)} />
                      </div>
                    </td>
                    <td>
                      <UserChip name={request.requester.name} />
                    </td>
                    <td>{request.taskSummary ? <TaskProgress summary={request.taskSummary} /> : '-'}</td>
                    <td className="whitespace-nowrap text-ink-2">{formatElapsed(request.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Sheet>

      <Sheet title="중단하면 이렇게 됩니다" icon={<OctagonX size={16} aria-hidden />} className="border-high/40">
        <ul className="flex flex-col gap-2.5 text-[0.8125rem] text-ink-2">
          {CONSEQUENCES.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-2">
              <Icon size={15} className="mt-0.5 shrink-0 text-ink-3" aria-hidden />
              {text}
            </li>
          ))}
        </ul>
        <Button
          variant="danger"
          size="lg"
          className="mt-4 w-full"
          disabled={count === 0}
          disabledReason="실행 중인 요청이 없습니다"
          onClick={() => setConfirming(true)}
        >
          <OctagonX size={17} aria-hidden />
          전사 일괄 중단
        </Button>
        <p className="mt-2 text-xs text-ink-3">사유와 확인 문구를 넣어야 실행됩니다.</p>
      </Sheet>

      <KillAllDialog open={confirming} onClose={() => setConfirming(false)} />
    </div>
  )
}
