import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Lock } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { requestsApi } from '../api/endpoints'
import type { RequiredApprovers, Task } from '../api/types'
import { makeUnifiedDiff } from '../lib/diff'
import { RISK_LABEL, RULE_LABEL, TASK_TYPE_LABEL } from '../lib/labels'
import { useDepartmentNames } from '../lib/queries'
import { RiskBadge, TaskStatusBadge } from './badges'
import { ChangeDetails, ChangeStats, ChangeSummary, ImpactLine } from './ChangeExplanation'
import { DiffViewer } from './DiffViewer'
import { Banner, CodeBlock, Spinner } from './ui'

export function approversText(required: RequiredApprovers): string {
  const { additional, ...first } = required
  return [first, ...(additional ?? [])].map((r) => RULE_LABEL[r.rule]).join(' + ')
}

/**
 * 실제 변경 내용: 코드 diff(좌우 비교), 배포 명령, 쿼리, 문서 본문.
 * 문서 비교는 서버가 준 diff를 믿지 않고, 해시로 검증한 content.body로 화면에서 직접 만든다.
 */
export function TaskContentView({ task, requestId }: { task: Task; requestId?: string }) {
  const { content } = task
  const showDocument = task.type === 'DOC' && Boolean(requestId) && content.body !== undefined
  const documentQuery = useQuery({
    queryKey: ['task-document', requestId, task.id, task.content.body],
    queryFn: () => requestsApi.taskDocument(requestId as string, task.id),
    enabled: showDocument,
  })
  const currentBody = documentQuery.data?.currentBody
  const documentDiff = useMemo(
    () =>
      currentBody === undefined || content.body === undefined
        ? null
        : makeUnifiedDiff(task.target, currentBody, content.body),
    [currentBody, content.body, task.target],
  )
  if (showDocument) {
    if (documentQuery.isPending) return <Spinner label="문서 비교를 불러오는 중" />
    if (documentDiff !== null) {
      return (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-ink-3">
            {documentQuery.data?.currentVersion
              ? `기존 문서 v${documentQuery.data.currentVersion}와 AI가 완성한 문서를 비교합니다.`
              : 'AI가 새로 작성한 문서입니다.'}
          </p>
          <DiffViewer diff={documentDiff} />
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

/** 작업 유형과 대상. 사람이 판단할 때는 보조 정보다. */
function TaskMeta({ task }: { task: Task }) {
  return (
    <>
      <span>{TASK_TYPE_LABEL[task.type]}</span>
      <span className="font-mono break-all">{task.target}</span>
    </>
  )
}

/**
 * Plan 작업 카드. 작업 요청·요청 상세·승인 상세가 같이 쓴다.
 * 위험도, 제목, 쉬운 설명 한 문장만 먼저 보여 주고 나머지는 "자세히"에 접어 둔다.
 * - highlighted: 재승인 화면에서 바뀐 작업 강조
 * - leading: 승인 체크박스 등 카드 왼쪽 요소
 * - actions: 수정·삭제 등 카드 오른쪽 위 버튼
 * - footer: 승인 현황 등 카드 아래 내용
 * - defaultOpen: "자세히"를 펼쳐 둔다 (승인 상세의 고위험 작업)
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
  const [open, setOpen] = useState(defaultOpen)
  return (
    <article
      className={`rounded-xl border ${
        forbidden
          ? 'border-rule bg-forbidden-soft/50'
          : highlighted
            ? 'border-medium bg-sheet ring-2 ring-medium/30'
            : 'border-rule bg-sheet'
      }`}
    >
      <div className="flex gap-3 p-5">
        {leading && <div className="pt-1">{leading}</div>}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <RiskBadge risk={task.risk} />
              <h3 className={`text-lg font-semibold ${forbidden ? 'text-forbidden' : ''}`}>
                {forbidden && <Lock size={14} className="mr-1 inline-block align-[-2px]" aria-hidden />}
                {task.title}
              </h3>
              <span className="font-mono text-xs text-ink-3">{task.id}</span>
              {highlighted && (
                <span className="rounded bg-medium-soft px-1.5 py-0.5 text-xs font-medium text-medium">바뀐 작업</span>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              {showStatus && <TaskStatusBadge status={task.status} />}
              {actions}
            </div>
          </div>

          {forbidden ? (
            task.forbiddenReason && (
              <div className="mt-2">
                <Banner tone="neutral" title="부서 금지 작업이라 승인할 수 없습니다">
                  {task.forbiddenReason}
                </Banner>
              </div>
            )
          ) : (
            <>
              {/* 펼치면 이전 → 이후와 영향이 아래 칸에 크게 나오므로 위에서는 뺀다 */}
              <ChangeSummary task={task} showPairs={!open} />
              {!open && <ImpactLine task={task} />}
            </>
          )}

          {task.riskRaised && (
            <p className="mt-1.5 text-sm text-high">
              AI가 위험도를 올렸습니다: {RISK_LABEL[task.riskRaised.from]} → {RISK_LABEL[task.risk]}. {task.riskRaised.reason}
            </p>
          )}

          {forbidden && (
            <p className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-ink-3">
              <TaskMeta task={task} />
              <span>{task.relatedDepartments.map(departmentName).join(', ')}</span>
              <span>승인 불가 (실행 차단)</span>
            </p>
          )}

          {!forbidden && (
            <details className="group mt-3" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
              <summary className="flex list-none flex-wrap items-center gap-x-4 gap-y-1.5 [&::-webkit-details-marker]:hidden">
                <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-rule-strong bg-sheet px-3 text-sm font-medium text-ink transition-colors hover:border-seal hover:text-seal">
                  <span className="group-open:hidden">자세히 보기</span>
                  <span className="hidden group-open:inline">접기</span>
                  <ChevronDown size={15} className="transition-transform group-open:rotate-180" aria-hidden />
                </span>
                <ChangeStats task={task} />
                <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-ink-3">
                  <TaskMeta task={task} />
                  <span>승인: {approversText(task.requiredApprovers)}</span>
                </span>
              </summary>
              <div className="mt-4 flex flex-col gap-4">
                <ChangeDetails task={task} />
                <section aria-label="실제 변경 내용" className="flex flex-col gap-2">
                  <div>
                    <h4 className="text-sm font-semibold text-ink-2">실제 변경 내용</h4>
                    <p className="text-xs text-ink-3">
                      위 설명은 AI가 쓴 참고 자료입니다. 승인 서명의 기준은 이 실제 변경 내용입니다.
                    </p>
                  </div>
                  <TaskContentView task={task} requestId={requestId} />
                </section>
              </div>
            </details>
          )}

          {footer && <div className="mt-3 border-t border-rule pt-3">{footer}</div>}
        </div>
      </div>
    </article>
  )
}
