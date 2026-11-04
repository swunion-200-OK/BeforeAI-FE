import { useQuery } from '@tanstack/react-query'
import { Building2, ChevronDown, Code2, Crosshair, Lock, Sparkles, UserCheck } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { requestsApi } from '../api/endpoints'
import type { RequiredApprovers, Task } from '../api/types'
import { makeUnifiedDiff } from '../lib/diff'
import { RISK_LABEL, RULE_LABEL } from '../lib/labels'
import { useDepartmentNames } from '../lib/queries'
import { RiskBadge, TaskStatusBadge, TaskTypeTag } from './badges'
import { ChangeExplanation, ChangeStats } from './ChangeExplanation'
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

function Meta({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[0.8125rem]">
      <span className="text-ink-3" aria-hidden>
        {icon}
      </span>
      <span className="sr-only">{label}: </span>
      <span className="min-w-0 break-all text-ink-2">{children}</span>
    </span>
  )
}

/**
 * Plan 작업 카드. 작업 요청·요청 상세·승인 상세가 같이 쓴다.
 * 쉬운 설명을 먼저 보여 주고, 실제 변경 내용은 그 아래 근거로 둔다.
 * - highlighted: 재승인 화면에서 바뀐 작업 강조
 * - leading: 승인 체크박스 등 카드 왼쪽 요소
 * - actions: 수정·삭제 등 카드 오른쪽 위 버튼
 * - footer: 승인 현황 등 카드 아래 내용
 * - defaultOpen: 실제 변경 내용을 펼쳐 둔다 (승인 상세)
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
      className={`rounded-xl border shadow-card ${
        forbidden
          ? 'border-rule-strong bg-forbidden-soft/50'
          : highlighted
            ? 'border-medium bg-sheet ring-2 ring-medium/30'
            : 'border-rule bg-sheet'
      }`}
    >
      <div className="flex gap-3 p-4">
        {leading && <div className="pt-1">{leading}</div>}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="rounded bg-paper px-1.5 py-0.5 font-mono text-xs text-ink-2">{task.id}</span>
              <h3 className={`text-[0.9375rem] font-semibold ${forbidden ? 'text-forbidden' : ''}`}>
                {forbidden && <Lock size={14} className="mr-1 inline-block align-[-2px]" aria-hidden />}
                {task.title}
              </h3>
              {highlighted && (
                <span className="rounded bg-medium-soft px-1.5 py-0.5 text-xs font-medium text-medium">바뀐 작업</span>
              )}
            </div>
            {actions && <div className="flex shrink-0 flex-wrap gap-1.5">{actions}</div>}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <RiskBadge risk={task.risk} />
            <TaskTypeTag type={task.type} />
            {showStatus && <TaskStatusBadge status={task.status} />}
            <Meta icon={<Crosshair size={13} />} label="대상">
              <span className="font-mono text-xs">{task.target}</span>
            </Meta>
            <Meta icon={<Building2 size={13} />} label="연관 부서">
              {task.relatedDepartments.map(departmentName).join(', ')}
            </Meta>
            <Meta icon={<UserCheck size={13} />} label="승인권자">
              {forbidden ? '승인 불가 (실행 차단)' : approversText(task.requiredApprovers)}
            </Meta>
          </div>

          {task.riskRaised && (
            <p className="mt-2 flex items-start gap-1.5 rounded-md bg-high-soft px-2.5 py-1.5 text-[0.8125rem] text-high">
              <Sparkles size={14} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                AI가 위험도를 올림: {RISK_LABEL[task.riskRaised.from]} → {RISK_LABEL[task.risk]}. {task.riskRaised.reason}
              </span>
            </p>
          )}

          {forbidden && task.forbiddenReason && (
            <div className="mt-3">
              <Banner tone="neutral" title="부서 금지 작업이라 승인할 수 없습니다">
                {task.forbiddenReason}
              </Banner>
            </div>
          )}

          {!forbidden && (
            <>
              <div className="mt-3">
                <ChangeExplanation task={task} />
              </div>
              <details className="group mt-2.5" open={defaultOpen}>
                <summary className="inline-flex list-none items-center gap-2 rounded text-[0.8125rem] font-medium text-seal hover:underline [&::-webkit-details-marker]:hidden">
                  <Code2 size={14} aria-hidden />
                  실제 변경 내용 보기
                  <ChevronDown size={14} className="transition-transform group-open:rotate-180" aria-hidden />
                  <span className="font-normal no-underline">
                    <ChangeStats task={task} />
                  </span>
                </summary>
                <div className="mt-2">
                  <TaskContentView task={task} requestId={requestId} />
                  <p className="mt-1.5 text-xs text-ink-3">
                    위 설명은 AI가 쓴 참고 자료입니다. 승인 서명의 기준은 이 실제 변경 내용입니다.
                  </p>
                </div>
              </details>
            </>
          )}

          {footer && <div className="mt-3 border-t border-rule pt-3">{footer}</div>}
        </div>
      </div>
    </article>
  )
}
