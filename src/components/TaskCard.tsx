import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Lock, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import { requestsApi } from '../api/endpoints'
import type { RequiredApprovers, Task } from '../api/types'
import { RISK_LABEL, RULE_LABEL } from '../lib/labels'
import { useDepartmentNames } from '../lib/queries'
import { RiskBadge, TaskStatusBadge, TaskTypeTag } from './badges'
import { DiffViewer } from './DiffViewer'
import { Banner, CodeBlock, Spinner } from './ui'

export function approversText(required: RequiredApprovers): string {
  const { additional, ...first } = required
  return [first, ...(additional ?? [])].map((r) => RULE_LABEL[r.rule]).join(' + ')
}

/** 변경 내용 뷰어: 코드 diff(좌우 비교), 배포 명령, 쿼리, 문서 본문 */
export function TaskContentView({ task, requestId }: { task: Task; requestId?: string }) {
  const { content } = task
  const showDocument = task.type === 'DOC' && Boolean(requestId)
  const documentQuery = useQuery({
    queryKey: ['task-document', requestId, task.id, task.content.body],
    queryFn: () => requestsApi.taskDocument(requestId as string, task.id),
    enabled: showDocument,
  })
  if (showDocument) {
    if (documentQuery.isPending) return <Spinner label="문서 비교를 불러오는 중" />
    if (documentQuery.data) {
      return (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-ink-3">
            {documentQuery.data.currentVersion
              ? `기존 문서 v${documentQuery.data.currentVersion}와 AI가 완성한 문서를 비교합니다.`
              : 'AI가 새로 작성한 문서입니다.'}
          </p>
          <DiffViewer diff={documentQuery.data.diff} />
        </div>
      )
    }
  }
  return (
    <div className="flex flex-col gap-2">
      {content.diff !== undefined && <DiffViewer diff={content.diff} />}
      {content.command !== undefined && <CodeBlock label="실행 명령">{content.command}</CodeBlock>}
      {content.query !== undefined && <CodeBlock label="쿼리">{content.query}</CodeBlock>}
      {content.body !== undefined && <CodeBlock label="문서 본문">{content.body}</CodeBlock>}
    </div>
  )
}

/**
 * Plan 작업 카드. 작업 요청·요청 상세·승인 상세가 같이 쓴다.
 * - highlighted: 재승인 화면에서 바뀐 작업 강조
 * - leading: 승인 체크박스 등 카드 왼쪽 요소
 * - actions: 수정·삭제 등 카드 오른쪽 위 버튼
 * - footer: 승인 현황 등 카드 아래 내용
 */
export function TaskCard({
  task,
  requestId,
  highlighted,
  leading,
  actions,
  footer,
  showStatus = true,
  defaultOpen = false,
}: {
  task: Task
  requestId?: string
  highlighted?: boolean
  leading?: ReactNode
  actions?: ReactNode
  footer?: ReactNode
  showStatus?: boolean
  defaultOpen?: boolean
}) {
  const departmentName = useDepartmentNames()
  const forbidden = task.risk === 'FORBIDDEN'
  return (
    <article
      className={`rounded-md border bg-sheet ${
        forbidden
          ? 'border-rule-strong bg-forbidden-soft/60'
          : highlighted
            ? 'border-medium ring-2 ring-medium/40'
            : 'border-rule'
      }`}
    >
      <div className="flex gap-3 p-4">
        {leading && <div className="pt-0.5">{leading}</div>}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-ink-3">{task.id}</span>
              <h3 className={`text-[0.9375rem] ${forbidden ? 'text-forbidden' : ''}`}>
                {forbidden && <Lock size={14} className="mr-1 inline-block align-[-2px]" aria-hidden />}
                {task.title}
              </h3>
              {highlighted && (
                <span className="rounded bg-medium-soft px-1.5 py-0.5 text-xs font-medium text-medium">바뀐 작업</span>
              )}
            </div>
            {actions && <div className="flex shrink-0 flex-wrap gap-1.5">{actions}</div>}
          </div>

          {task.description && <p className="mt-1 max-w-[80ch] text-sm text-ink-2">{task.description}</p>}

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <RiskBadge risk={task.risk} />
            <TaskTypeTag type={task.type} />
            {showStatus && <TaskStatusBadge status={task.status} />}
          </div>

          {task.riskRaised && (
            <p className="mt-2 flex items-start gap-1.5 text-[0.8125rem] text-high">
              <Sparkles size={14} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                AI가 위험도를 올림: {RISK_LABEL[task.riskRaised.from]} → {RISK_LABEL[task.risk]}. {task.riskRaised.reason}
              </span>
            </p>
          )}

          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[0.8125rem]">
            <dt className="text-ink-3">대상</dt>
            <dd className="font-mono break-all text-ink">{task.target}</dd>
            <dt className="text-ink-3">연관 부서</dt>
            <dd>{task.relatedDepartments.map(departmentName).join(', ')}</dd>
            <dt className="text-ink-3">승인권자</dt>
            <dd>{forbidden ? '승인 불가 (실행 차단)' : approversText(task.requiredApprovers)}</dd>
          </dl>

          {forbidden && task.forbiddenReason && (
            <div className="mt-3">
              <Banner tone="neutral" title="부서 금지 작업이라 승인할 수 없습니다">
                {task.forbiddenReason}
              </Banner>
            </div>
          )}

          {!forbidden && (
            <details className="group mt-3" open={defaultOpen}>
              <summary className="inline-flex list-none items-center gap-1 text-[0.8125rem] font-medium text-seal hover:underline [&::-webkit-details-marker]:hidden">
                <ChevronDown size={14} className="transition-transform group-open:rotate-180" aria-hidden />
                예상 변경 보기
              </summary>
              <div className="mt-2">
                <TaskContentView task={task} requestId={requestId} />
              </div>
            </details>
          )}

          {footer && <div className="mt-3 border-t border-rule pt-3">{footer}</div>}
        </div>
      </div>
    </article>
  )
}
