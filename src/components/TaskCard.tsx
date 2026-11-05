import { useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { documentsApi, requestsApi } from '../api/endpoints'
import type { ApproverRequirement, PlanKind, RequestStatus, Task } from '../api/types'
import { RISK_LABEL, RULE_LABEL, TASK_TYPE_LABEL, forbiddenReasonText } from '../lib/labels'
import { useDepartmentNames, useRequest } from '../lib/queries'
import { INTERRUPTED_WORD, shownTaskStatus } from '../lib/settledTask'
import { josa } from '../lib/josa'
import { compareTaskDocument, compareWithCurrent, type DocumentCompare } from '../lib/taskDocument'
import { RiskBadge, StatusText, TaskStatusBadge } from './badges'
import { ChangeDetails, ChangeStats, ChangeSummary, ImpactLine } from './ChangeExplanation'
import { DiffViewer } from './DiffViewer'
import { Banner, CodeBlock, Spinner } from './ui'

export function approversText(required: ApproverRequirement[]): string {
  return required.map((r) => RULE_LABEL[r.rule]).join(' + ')
}

const BASE_UNVERIFIED = '서명 대상은 아래 문서 전체 내용입니다. 비교의 기준 문서는 서명으로 확인되지 않습니다.'

/** 비교를 믿을 수 없거나 받지 못했을 때. 비교 없이 서명하지 않도록 그 사실을 먼저 말하고 전체 내용을 펼쳐 둔다. */
function DocumentNotice({ title, detail = '아래 전체 내용을 확인한 뒤 결정해 주세요.', body }: { title: string; detail?: string; body: string }) {
  return (
    <div className="flex flex-col gap-2">
      <Banner tone="warning" title={title}>
        {detail}
      </Banner>
      <CodeBlock label="문서 전체 내용">{body}</CodeBlock>
    </div>
  )
}

/** 비교와 전체 내용. 기준 문서는 해시 대상이 아니라 숨길 수 있으므로 서명 대상이 전체 내용이라고 비교 위에 쓰고, 전체 내용을 펼쳐 둔다. */
function DocumentDiff({ caption, diff, body }: { caption: string; diff: string; body: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-ink-2">{BASE_UNVERIFIED}</p>
      <p className="text-xs text-ink-3">{caption}</p>
      <DiffViewer diff={diff} />
      <details open className="group">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
          문서 전체 내용
          <ChevronDown size={14} className="transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="quiet-scroll mt-2 max-h-96 overflow-y-auto">
          <CodeBlock>{body}</CodeBlock>
        </div>
      </details>
    </div>
  )
}

function DocumentCompareView({ compare, caption, body }: { compare: DocumentCompare; caption: string; body: string }) {
  if (compare.kind === 'mismatch') return <DocumentNotice title="비교 자료가 서명할 문서와 맞지 않아 보여 주지 않습니다" body={body} />
  if (compare.kind === 'noChange') return <DocumentNotice title="비교할 문서와 달라진 줄이 없습니다" detail={BASE_UNVERIFIED} body={body} />
  return <DocumentDiff caption={caption} diff={compare.diff} body={body} />
}

/**
 * 실제 변경 내용: 코드 diff(좌우 비교), 배포 명령, 쿼리, 문서 본문.
 * 문서 비교는 서버 diff를 믿지 않고, 해시로 검증한 content.body로 화면에서 다시 만든다 (lib/taskDocument.ts).
 * planKind: 롤백 Plan이면 서버 비교 기준이 현재 문서가 아니라서 현재 문서를 따로 받아 비교한다.
 */
export function TaskContentView({ task, requestId, planKind }: { task: Task; requestId?: string; planKind?: PlanKind }) {
  // 서버의 해시 대상은 내용 없는 작업을 빈 객체로 다룬다 (PlanHashService.contentTarget). 화면도 깨지지 않게 같게 본다.
  const content = task.content ?? {}
  const showDocument = task.type === 'DOC' && Boolean(requestId) && content.body !== undefined
  const documentQuery = useQuery({
    queryKey: ['task-document', requestId, task.id, content.body],
    queryFn: () => requestsApi.taskDocument(requestId as string, task.id),
    enabled: showDocument,
  })
  const isRollback = planKind === 'ROLLBACK'
  const currentDocumentId = showDocument && isRollback ? (documentQuery.data?.documentId ?? null) : null
  // 현재 버전은 프로젝트의 문서 목록에 있다. 요청 상세는 화면들이 이미 받아 두는 값이다.
  const owner = useRequest(currentDocumentId !== null ? requestId : undefined)
  const projectId = owner.data?.projectId
  const currentQuery = useQuery({
    queryKey: ['task-document-current', projectId, currentDocumentId],
    queryFn: () => documentsApi.current(projectId as string, currentDocumentId as string),
    enabled: currentDocumentId !== null && Boolean(projectId),
  })
  // 요청 상세를 다시 받을 때마다 같은 비교를 다시 만들지 않는다.
  const compare = useMemo(
    () => (documentQuery.data && content.body !== undefined ? compareTaskDocument(documentQuery.data, content.body, task.target) : null),
    [documentQuery.data, content.body, task.target],
  )
  const currentCompare = useMemo(
    () => (currentQuery.data && content.body !== undefined ? compareWithCurrent(task.target, currentQuery.data.body, content.body) : null),
    [currentQuery.data, content.body, task.target],
  )

  let documentView: ReactNode = null
  if (showDocument && content.body !== undefined) {
    const waitingCurrent = currentDocumentId !== null && (owner.isPending || (Boolean(projectId) && currentQuery.isPending))
    if (documentQuery.isPending) documentView = <Spinner label="문서 비교를 불러오는 중" />
    else if (!documentQuery.data) documentView = <DocumentNotice title="기존 문서와 비교하지 못했습니다" body={content.body} />
    else if (isRollback && documentQuery.data.body !== content.body) documentView = <DocumentCompareView compare={{ kind: 'mismatch' }} caption="" body={content.body} />
    else if (isRollback && waitingCurrent) documentView = <Spinner label="현재 문서를 불러오는 중" />
    else if (isRollback && (!currentQuery.data || !currentCompare)) documentView = <DocumentNotice title="현재 문서와 비교하지 못했습니다" body={content.body} />
    else if (isRollback && currentQuery.data && currentCompare) {
      documentView = <DocumentCompareView compare={currentCompare} caption={`현재 문서 ${josa(`v${currentQuery.data.version}`, '과', '와')} 되돌릴 내용을 비교합니다.`} body={content.body} />
    } else if (compare) {
      const { baseVersion } = documentQuery.data
      const caption =
        compare.kind === 'diff' && compare.isNew
          ? 'AI가 새로 작성한 문서입니다.'
          : baseVersion
            ? `기존 문서 ${josa(`v${baseVersion}`, '과', '와')} AI가 완성한 문서를 비교합니다.`
            : '기존 문서와 AI가 완성한 문서를 비교합니다.'
      documentView = <DocumentCompareView compare={compare} caption={caption} body={content.body} />
    }
  }
  return (
    <div className="flex flex-col gap-2">
      {documentView}
      {/* 문서 작업이어도 다른 필드가 있으면 서명 대상이므로 숨기지 않는다. */}
      {content.diff !== undefined && <DiffViewer diff={content.diff} />}
      {content.command !== undefined && <CodeBlock label="실행 명령">{content.command}</CodeBlock>}
      {content.query !== undefined && <CodeBlock label="쿼리">{content.query}</CodeBlock>}
      {content.body !== undefined && documentView === null && <CodeBlock label="문서 본문">{content.body}</CodeBlock>}
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

/** 작업 카드들을 테두리 하나에 담고 가로줄로 나눈다. */
export function TaskRows({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-rule overflow-hidden rounded-lg border border-rule bg-sheet">{children}</div>
}

/** 지금 봐야 할 작업의 왼쪽 선. 자리를 차지하지 않아 다른 행과 글자 줄이 어긋나지 않는다. */
const EDGE = {
  changed: 'shadow-[inset_3px_0_0_var(--color-medium)]',
  running: 'shadow-[inset_3px_0_0_var(--color-medium)]',
  failed: 'shadow-[inset_3px_0_0_var(--color-high)]',
} as const

/**
 * Plan 작업 카드. 작업 요청·요청 상세·승인 상세가 같이 쓴다. TaskRows 안에 놓는다.
 * 위험도, 제목, 쉬운 설명 한 문장만 먼저 보여 주고 나머지는 "자세히"에 접어 둔다.
 * - number: 화면에 쓰는 작업 번호. 1부터 센다 (lib/taskLabel.ts)
 * - requestStatus: 끝난 요청의 작업을 승인 대기로 보이지 않게 한다
 * - planKind: 롤백 Plan이면 문서를 현재 문서와 비교한다
 * - interrupted: 실행 중 킬 스위치로 멈춘 작업. 시작 전 작업과 구별해 보여 준다
 * - highlighted: 재승인 화면에서 바뀐 작업 강조
 * - spotlight: 실행 중이거나 실패한 작업 강조
 * - leading: 승인 체크박스 등 카드 왼쪽 요소
 * - actions: 수정·삭제 등 카드 오른쪽 위 버튼
 * - footer: 승인 현황 등 카드 아래 내용
 * - defaultOpen: "자세히"를 펼쳐 둔다 (승인 상세의 고위험 작업)
 */
export function TaskCard({
  task,
  number,
  requestId,
  requestStatus,
  planKind,
  interrupted,
  highlighted,
  spotlight,
  leading,
  actions,
  footer,
  showStatus = true,
  defaultOpen = false,
}: {
  task: Task
  number: number
  requestId?: string
  requestStatus?: RequestStatus
  planKind?: PlanKind
  interrupted?: boolean
  highlighted?: boolean
  spotlight?: 'running' | 'failed'
  leading?: ReactNode
  actions?: ReactNode
  footer?: ReactNode
  showStatus?: boolean
  defaultOpen?: boolean
}) {
  const departmentName = useDepartmentNames()
  const forbidden = task.risk === 'FORBIDDEN'
  const [open, setOpen] = useState(defaultOpen)
  const edge = spotlight ? EDGE[spotlight] : highlighted ? EDGE.changed : ''
  return (
    <article className={`${forbidden ? 'bg-sheet-alt' : ''} ${edge}`}>
      <div className="flex gap-3 p-5">
        {leading && <div className="pt-1.5">{leading}</div>}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
              <RiskBadge risk={task.risk} />
              <h3 className={`text-lg font-semibold ${forbidden ? 'text-forbidden' : ''}`}>{task.title}</h3>
              <span className="font-mono text-xs text-ink-3">#{number}</span>
              {highlighted && <span className="text-xs font-semibold text-medium">바뀐 작업</span>}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {showStatus &&
                (interrupted ? (
                  <StatusText tone="red" shape="stop">
                    {INTERRUPTED_WORD}
                  </StatusText>
                ) : (
                  <TaskStatusBadge status={shownTaskStatus(task.status, requestStatus)} />
                ))}
              {actions}
            </div>
          </div>

          {forbidden ? (
            <div className="mt-2">
              <Banner tone="neutral" title="부서 금지 작업이라 승인할 수 없습니다">
                {forbiddenReasonText(task)}
              </Banner>
            </div>
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
              <summary className="flex min-h-8 list-none flex-wrap items-center gap-x-4 gap-y-1 [&::-webkit-details-marker]:hidden">
                <span className="inline-flex items-center gap-1 text-sm font-medium text-seal hover:underline">
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
              <div className="mt-4 flex flex-col gap-6">
                <ChangeDetails task={task} />
                <section aria-label="실제 변경 내용" className="flex flex-col gap-2">
                  <div>
                    <h4 className="text-sm font-semibold text-ink-2">실제 변경 내용</h4>
                    <p className="text-xs text-ink-3">
                      {task.explanation ? '위 설명은 AI가 쓴 참고 자료입니다. ' : ''}승인 서명의 기준은 이 실제 변경 내용입니다.
                    </p>
                  </div>
                  <TaskContentView task={task} requestId={requestId} planKind={planKind} />
                </section>
              </div>
            </details>
          )}

          {footer && <div className="mt-3">{footer}</div>}
        </div>
      </div>
    </article>
  )
}
