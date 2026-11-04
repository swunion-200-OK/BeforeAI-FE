import { Globe } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { RiskBadge, TaskTypeTag } from '../../components/badges'
import { Banner, EmptyState, ErrorState, PageHeader, Sheet, Spinner } from '../../components/ui'
import { formatDateTime, formatElapsed } from '../../lib/format'
import { useDepartmentNames, usePendingApprovals } from '../../lib/queries'

export default function PendingListPage() {
  const pending = usePendingApprovals()
  const departmentName = useDepartmentNames()
  const navigate = useNavigate()
  const hasBlocked = pending.data?.some((item) => item.blockedReason) ?? false

  return (
    <>
      <PageHeader
        title="승인 대기"
        description="내 승인이 필요한 작업입니다. 오래 기다린 작업부터 보여 줍니다."
      />
      {hasBlocked && (
        <div className="mb-4">
          <Banner tone="warning" title="외부망에서는 코드 수정(낮음·중간)만 승인할 수 있습니다">
            "내부망 승인 필요"로 표시한 작업은 내용만 볼 수 있고, 승인은 내부망에서 합니다.
          </Banner>
        </div>
      )}
      <Sheet flush>
        {pending.isPending && <Spinner />}
        {pending.isError && <ErrorState error={pending.error} onRetry={() => pending.refetch()} />}
        {pending.data?.length === 0 && (
          <EmptyState title="지금 승인할 작업이 없습니다">새 승인 요청이 오면 이 목록과 Slack으로 알려 드립니다.</EmptyState>
        )}
        {pending.data && pending.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="sheet-table">
              <thead>
                <tr>
                  <th>위험도</th>
                  <th>작업명</th>
                  <th>요청자(부서)</th>
                  <th>프로젝트</th>
                  <th>대기 시간</th>
                </tr>
              </thead>
              <tbody>
                {pending.data.map((item) => (
                  <tr
                    key={`${item.requestId}-${item.taskId}`}
                    data-clickable="true"
                    onClick={() => navigate(`/approvals/${item.requestId}`)}
                  >
                    <td>
                      <RiskBadge risk={item.risk} />
                    </td>
                    <td>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          to={`/approvals/${item.requestId}`}
                          onClick={(event) => event.stopPropagation()}
                          className="font-medium text-ink hover:text-seal hover:underline"
                        >
                          {item.taskTitle}
                        </Link>
                        <TaskTypeTag type={item.type} />
                      </div>
                      {item.blockedReason && (
                        <p className="mt-1 flex items-center gap-1 text-xs font-medium text-external">
                          <Globe size={12} aria-hidden />
                          내부망 승인 필요
                        </p>
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      {item.requester.name}
                      <span className="text-ink-3"> ({departmentName(item.requester.departmentId)})</span>
                    </td>
                    <td className="whitespace-nowrap">{item.projectName}</td>
                    <td className="whitespace-nowrap" title={formatDateTime(item.requestedAt)}>
                      {formatElapsed(item.requestedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Sheet>
    </>
  )
}
