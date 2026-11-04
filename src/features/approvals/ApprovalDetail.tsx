import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { ArrowRight, CircleCheck, ExternalLink, Globe, ShieldCheck, ShieldX, Stamp } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { approvalsApi, meApi } from '../../api/endpoints'
import { ApiError, errorMessage } from '../../api/errors'
import type { Plan, Risk, SubmitApprovalResponse, Task, TaskApprovalStatus } from '../../api/types'
import { useMe } from '../../app/AuthProvider'
import { ApprovalStamps, approvalSummary } from '../../components/ApprovalStamps'
import { RequestStatusBadge } from '../../components/badges'
import { ProjectTag, RiskSummary, UserChip } from '../../components/rich'
import { TaskCard } from '../../components/TaskCard'
import { toast } from '../../components/toast'
import { Banner, Button, EmptyState, ErrorState, Mono, ReasonModal, Spinner } from '../../components/ui'
import { deviceStore } from '../../crypto/deviceStore'
import { signingService } from '../../crypto/signingService'
import { formatDateTime } from '../../lib/format'
import { REQUEST_STATUS_LABEL, SOURCE_LABEL } from '../../lib/labels'
import { useDepartmentNames, useRefreshAll, useRequest } from '../../lib/queries'
import { signAndSubmitApproval, verifyIntegrity, type SignStep } from './approvalFlow'
import { IntegrityCheck } from './IntegrityCheck'
import { SignProgress, type SignRunState } from './SignProgress'

/** 단계가 눈에 보이도록 시연용으로 잠깐씩 멈춘다. */
const STEP_DELAY_MS = 350
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type DecisionKind = 'reject' | 'change'

function PlanStrip({ plan }: { plan: Plan }) {
  const risks: Record<Risk, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, FORBIDDEN: 0 }
  for (const task of plan.tasks) risks[task.risk] += 1
  return (
    <dl className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl border border-rule bg-sheet px-4 py-2.5 text-[0.8125rem] shadow-card">
      <div className="flex items-center gap-2">
        <dt className="text-ink-3">작업</dt>
        <dd className="flex items-center gap-2">
          <span className="font-semibold">{plan.tasks.length}개</span>
          <RiskSummary risks={risks} />
        </dd>
      </div>
      <div className="flex items-center gap-2">
        <dt className="text-ink-3">저장소</dt>
        <dd>
          <Mono>{plan.repository}</Mono>
        </dd>
      </div>
      <div className="flex items-center gap-2">
        <dt className="text-ink-3">기준 커밋</dt>
        <dd>
          <Mono>{plan.baseCommit}</Mono>
        </dd>
      </div>
      {plan.kind === 'ROLLBACK' && (
        <div className="flex items-center gap-2">
          <dt className="text-ink-3">종류</dt>
          <dd className="font-medium">문서 롤백 Plan</dd>
        </div>
      )}
    </dl>
  )
}

function TaskNote({
  status,
  approvable,
  blocked,
  task,
}: {
  status: TaskApprovalStatus | undefined
  approvable: boolean
  blocked: boolean
  task: Task
}) {
  if (blocked) {
    return (
      <p className="flex items-start gap-1.5 text-[0.8125rem] font-medium text-external">
        <Globe size={14} className="mt-0.5 shrink-0" aria-hidden />
        내부망 승인 필요: 외부망에서는 코드 수정(낮음·중간)만 승인할 수 있습니다.
      </p>
    )
  }
  if (!status) return null
  const summary = approvalSummary(status)
  if (approvable) return <p className="text-[0.8125rem] font-medium text-seal-dark">내가 승인할 수 있습니다. {summary}</p>
  if (task.status === 'PENDING') return <p className="text-[0.8125rem] text-ink-2">다른 승인권자 대기: {summary}</p>
  return <p className="text-[0.8125rem] text-ink-2">{summary}</p>
}

function ContextNotice({ error, requestId }: { error: unknown; requestId: string }) {
  const detailLink = (
    <Link to={`/requests/${requestId}`} className="font-medium underline">
      요청 상세 보기
    </Link>
  )
  if (error instanceof ApiError && error.code === 'NOT_APPROVER') {
    return (
      <Banner tone="warning" title="이 작업의 승인권자가 아닙니다" action={detailLink}>
        승인 현황과 실행 로그는 요청 상세에서 볼 수 있습니다.
      </Banner>
    )
  }
  return (
    <Banner tone="info" title="아직 승인할 수 없는 요청입니다" action={detailLink}>
      요청자가 Plan을 제출하면 승인할 수 있습니다.
    </Banner>
  )
}

function PanelSection({
  title,
  icon,
  aside,
  children,
}: {
  title: string
  icon: ReactNode
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="border-b border-rule px-4 py-3.5 last:border-b-0">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-[0.875rem] font-semibold">
          <span aria-hidden className="text-ink-3">
            {icon}
          </span>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** 결재가 끝났을 때 찍히는 큰 도장 */
function ResultSeal({ label }: { label: string }) {
  return (
    <span
      aria-hidden
      className="animate-stamp inline-flex size-[4.25rem] shrink-0 -rotate-6 items-center justify-center rounded-full border-[3px] border-seal text-seal outline-1 outline-offset-2 outline-seal/60"
    >
      <span className="text-lg font-bold tracking-tight">{label}</span>
    </span>
  )
}

function StampSheet({
  statuses,
  tasks,
  stampedBy,
}: {
  statuses: TaskApprovalStatus[]
  tasks: Task[]
  stampedBy?: string
}) {
  return (
    <ul className="flex flex-wrap gap-2.5">
      {statuses.map((status) => {
        const task = tasks.find((t) => t.id === status.taskId)
        return (
          <li key={status.taskId} className="min-w-[9.75rem] flex-1 rounded-lg bg-sheet-alt p-2.5">
            <p className="mb-2 text-[0.8125rem] leading-snug font-medium">
              <span className="mr-1 font-mono text-xs font-normal text-ink-3">{status.taskId}</span>
              <span title={task?.title}>{task?.title}</span>
            </p>
            <div className="overflow-x-auto [&>div]:bg-sheet">
              <ApprovalStamps status={status} justStampedBy={stampedBy} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export function ApprovalDetail({ requestId, nextRequestId }: { requestId: string; nextRequestId?: string }) {
  const me = useMe()
  const departmentName = useDepartmentNames()
  const refreshAll = useRefreshAll()
  const requestQuery = useRequest(requestId)
  const request = requestQuery.data

  // 다른 사람의 승인이나 Plan 변경으로 요청이 바뀌면 승인 자료도 다시 받는다.
  const contextQuery = useQuery({
    queryKey: ['approval-context', requestId, request?.currentPlanId ?? null, request?.updatedAt ?? null],
    queryFn: () => approvalsApi.context(requestId),
    enabled: Boolean(request),
    placeholderData: keepPreviousData,
  })
  const keysQuery = useQuery({
    queryKey: ['me', 'signing-keys'],
    queryFn: async () => (await meApi.signingKeys()).items,
  })

  const [deselected, setDeselected] = useState<ReadonlySet<string>>(new Set())
  const [step, setStep] = useState<SignStep | null>(null)
  const [runState, setRunState] = useState<SignRunState | null>(null)
  const [signError, setSignError] = useState<string | null>(null)
  const [result, setResult] = useState<{ response: SubmitApprovalResponse; doc: boolean } | null>(null)
  const [stampedBy, setStampedBy] = useState<string | undefined>()
  const [decision, setDecision] = useState<DecisionKind | null>(null)

  // 다시 받기에 실패하면 이전 자료를 믿지 않는다. 옛 Plan에 무결성 ✅와 활성 버튼이 남으면 안 된다.
  const context = contextQuery.isError ? undefined : contextQuery.data
  const integrity = useMemo(() => (context ? verifyIntegrity(context, me.id) : null), [context, me.id])

  // 서명 대상은 승인 자료의 Plan이고, 진행 상태만 요청 상세에서 최신 값을 가져온다.
  const tasks = useMemo<Task[]>(() => {
    const plan = context?.plan ?? request?.plan
    if (!plan) return []
    if (request?.plan?.id !== plan.id) return plan.tasks
    return plan.tasks.map((task) => ({
      ...task,
      status: request.plan?.tasks.find((t) => t.id === task.id)?.status ?? task.status,
    }))
  }, [context, request])

  const approvable = context?.approvableTaskIds ?? []
  const blocked = context?.blockedTaskIds ?? []
  const selected = approvable.filter((id) => !deselected.has(id))
  const selectedTasks = tasks.filter((t) => selected.includes(t.id))
  // 외부망에서 막힌 문서 작업도 버튼 문구는 적용/미적용이어야 해서, 고를 게 없으면 막힌 작업을 기준으로 삼는다.
  const decisionBase = (selected.length > 0 ? selected : approvable.length > 0 ? approvable : blocked)
    .map((id) => tasks.find((t) => t.id === id))
    .filter((t): t is Task => Boolean(t))
  // 문서 작업이면 적용 = 승인, 미적용 = 거부 (기능 명세서 5.4)
  const docMode = decisionBase.length > 0 && decisionBase.every((t) => t.type === 'DOC')

  // 서명은 이 기기의 키로 한다. 다른 기기에 등록된 키가 있어도 이 기기의 키가 등록되어 있어야 한다.
  const deviceKeyId = deviceStore.get(me.id).keyId
  const deviceKey = keysQuery.data?.find((key) => key.keyId === deviceKeyId)
  const keyChecking = keysQuery.isPending
  const keyReady = signingService.hasDeviceKey(me.id) && deviceKey?.status === 'REGISTERED'

  const sign = useMutation({
    meta: { silent: true },
    mutationFn: async (taskIds: string[]) => {
      if (!context) throw new Error('승인 자료를 불러오지 못했습니다')
      return signAndSubmitApproval({
        me,
        context,
        taskIds,
        onStep: async (next) => {
          setStep(next)
          await delay(STEP_DELAY_MS)
        },
      })
    },
    onMutate: () => {
      setStep(null)
      setRunState('running')
      setSignError(null)
      setResult(null)
      setStampedBy(undefined)
    },
    onSuccess: async (response) => {
      setRunState('done')
      setResult({ response, doc: docMode })
      setStampedBy(me.id)
      await refreshAll()
    },
    onError: async (error) => {
      setRunState('failed')
      setSignError(errorMessage(error))
      // PLAN_HASH_MISMATCH 등: 최신 Plan을 다시 받아 확인하게 한다.
      await refreshAll()
    },
  })

  const decide = useMutation({
    mutationFn: ({ reason, kind }: { reason: string; kind: DecisionKind }) =>
      approvalsApi.reject(requestId, {
        taskIds: selected,
        // TODO(spec): 기능 명세서 DEP-03에 "수정 요청"이 있지만 API가 없다. 거부 API에 표시를 붙여 사유로 전달한다.
        reason: kind === 'change' ? `[수정 요청] ${reason}` : reason,
      }),
    onSuccess: async (_data, { kind }) => {
      setDecision(null)
      toast.success(kind === 'change' ? '수정 요청을 보냈습니다' : docMode ? '미적용으로 처리했습니다' : '거부했습니다')
      await refreshAll()
    },
    onError: () => setDecision(null),
  })

  if (requestQuery.isPending) {
    return (
      <div className="min-w-0 flex-1">
        <Spinner />
      </div>
    )
  }
  // 제출 전의 Plan은 승인 후보에게 보이지 않는다. 승인 대기 중에 요청자가 Plan을 고치면 여기로 온다.
  if (requestQuery.error instanceof ApiError && requestQuery.error.code === 'NOT_FOUND') {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center bg-paper">
        <EmptyState
          title="이 요청은 지금 볼 수 없습니다"
          action={
            nextRequestId && (
              <Link to={`/approvals/${nextRequestId}`} className="inline-flex items-center gap-1 text-sm font-medium text-seal hover:underline">
                다음 승인 대기 열기
                <ArrowRight size={14} aria-hidden />
              </Link>
            )
          }
        >
          요청자가 Plan을 고치는 중이거나 조회 권한이 없는 요청입니다. 다시 제출되면 승인 대기에 나타납니다.
        </EmptyState>
      </div>
    )
  }
  if (requestQuery.isError || !request) {
    return (
      <div className="min-w-0 flex-1">
        <ErrorState error={requestQuery.error} onRetry={() => requestQuery.refetch()} />
      </div>
    )
  }

  const contextError = contextQuery.error
  const expectedContextError =
    contextError instanceof ApiError && (contextError.code === 'NOT_APPROVER' || contextError.code === 'INVALID_STATE')

  const toggle = (taskId: string) => {
    setDeselected((current) => {
      const next = new Set(current)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  // 서버가 거부하더라도, 지금 받는 Plan이 아니면 화면에서 먼저 막는다.
  const samePlan = Boolean(context) && request.currentPlanId === context?.plan.id
  const accepting = request.status === 'PENDING_APPROVAL' && samePlan && !contextQuery.isPlaceholderData

  let signBlockedReason: string | null = null
  if (integrity && !integrity.ok) signBlockedReason = 'Plan 무결성 확인에 실패해 서명할 수 없습니다.'
  else if (keyChecking) signBlockedReason = '승인 키를 확인하고 있습니다.'
  else if (keysQuery.isError) signBlockedReason = '승인 키 상태를 확인하지 못했습니다. 새로고침한 뒤 다시 시도해 주세요.'
  else if (!keyReady) signBlockedReason = '승인 키를 등록해야 서명할 수 있습니다.'
  else if (request.status !== 'PENDING_APPROVAL') signBlockedReason = '지금은 승인을 받지 않는 상태입니다.'
  else if (!samePlan) signBlockedReason = 'Plan이 바뀌었습니다. 새로고침 후 다시 확인해 주세요.'
  else if (contextQuery.isPlaceholderData) signBlockedReason = '최신 승인 자료를 확인하고 있습니다.'
  else if (approvable.length === 0) signBlockedReason = '지금 내가 승인할 수 있는 작업이 없습니다.'
  else if (selected.length === 0) signBlockedReason = '승인할 작업을 고르세요.'

  const approveLabel = docMode ? '적용' : '승인(서명)'
  const rejectLabel = docMode ? '미적용' : '거부'
  const plan = context?.plan ?? request.plan
  const stampsDone = request.approvalStatus.filter((s) => s.requirements.every((r) => r.satisfied)).length
  const nothingLeft = result?.response.remainingTaskIds.length === 0

  return (
    <>
      {/* 가운데: 무엇이 바뀌는지 */}
      <div className="quiet-scroll min-w-0 flex-1 overflow-y-auto bg-paper">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-3 px-5 py-4">
          <header>
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-[1.25rem] leading-snug font-bold tracking-tight whitespace-pre-wrap">{request.prompt}</h2>
              <Link
                to={`/requests/${requestId}`}
                className="inline-flex shrink-0 items-center gap-1 pt-1 text-[0.8125rem] font-medium text-seal hover:underline"
              >
                요청 상세 보기
                <ExternalLink size={13} aria-hidden />
              </Link>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <RequestStatusBadge status={request.status} />
              <UserChip name={request.requester.name} sub={departmentName(request.requester.departmentId)} />
              <ProjectTag name={request.projectName} />
              <span className="text-[0.8125rem] text-ink-3">{formatDateTime(request.createdAt)}</span>
              {request.source !== 'PROMPT' && (
                <span className="rounded bg-forbidden-soft px-1.5 py-0.5 text-xs text-forbidden">
                  {SOURCE_LABEL[request.source]}
                </span>
              )}
            </div>
          </header>

          {integrity && !integrity.ok && (
            <Banner tone="danger" title="이 Plan은 실행기가 만든 내용과 다를 수 있습니다">
              AI 설명은 검증되지 않은 참고 자료입니다. 실제 변경 내용을 확인하고, 서명하지 말고 관리자에게 알려 주세요.
            </Banner>
          )}
          {expectedContextError && <ContextNotice error={contextError} requestId={requestId} />}
          {contextQuery.isError && !expectedContextError && (
            <ErrorState error={contextError} onRetry={() => contextQuery.refetch()} />
          )}
          {context && keysQuery.isSuccess && !keyReady && (
            <Banner
              tone="warning"
              title="승인 키 등록 필요"
              action={
                <Link to="/me" className="font-medium underline">
                  내 정보로 이동
                </Link>
              }
            >
              {deviceKey?.status === 'PENDING'
                ? '승인 키가 관리자 등록을 기다리고 있습니다. 등록된 뒤 서명할 수 있습니다.'
                : me.signingKeyStatus === 'REGISTERED'
                  ? '이 기기에 등록된 승인 키가 없습니다. 키를 만든 기기에서 서명하거나 이 기기에서 새로 등록해 주세요.'
                  : '이 기기에서 승인 키를 만들고 관리자 등록을 받으면 서명할 수 있습니다.'}
            </Banner>
          )}
          {blocked.length > 0 && (
            <Banner tone="warning" title="외부망에서 승인할 수 없는 작업이 있습니다">
              코드 수정(낮음·중간)이 아닌 작업은 내부망에서 승인합니다. 내용은 여기서 확인할 수 있습니다.
            </Banner>
          )}
          {context && request.status !== 'PENDING_APPROVAL' && !result && (
            <Banner tone="neutral" title={`이 요청은 지금 ${REQUEST_STATUS_LABEL[request.status]} 상태라 승인을 받지 않습니다`} />
          )}

          {plan && <PlanStrip plan={plan} />}

          {tasks.map((task) => {
            const canApprove = approvable.includes(task.id)
            const isBlocked = blocked.includes(task.id)
            return (
              <TaskCard
                key={task.id}
                task={task}
                requestId={requestId}
                defaultOpen
                highlighted={request.changedTaskIds.includes(task.id)}
                leading={
                  !context || task.risk === 'FORBIDDEN' ? undefined : task.status === 'PENDING' ? (
                    <input
                      type="checkbox"
                      className="size-4 accent-seal disabled:cursor-not-allowed"
                      aria-label={`${task.title} 승인 대상으로 선택`}
                      checked={canApprove && !deselected.has(task.id)}
                      disabled={!canApprove}
                      title={isBlocked ? '내부망 승인 필요' : canApprove ? undefined : '지금 내가 승인할 수 없는 작업입니다'}
                      onChange={() => toggle(task.id)}
                    />
                  ) : (
                    <CircleCheck size={16} className="text-ink-3" aria-hidden />
                  )
                }
                footer={
                  task.risk === 'FORBIDDEN' ? undefined : (
                    <TaskNote
                      task={task}
                      approvable={canApprove}
                      blocked={isBlocked}
                      status={request.approvalStatus.find((s) => s.taskId === task.id)}
                    />
                  )
                }
              />
            )
          })}
        </div>
      </div>

      {/* 오른쪽: 확인하고 결정한다 */}
      <aside aria-label="승인 결정" className="flex w-[380px] shrink-0 flex-col border-l border-rule bg-sheet">
        <div className="quiet-scroll min-h-0 flex-1 overflow-y-auto">
          {integrity && context && (
            <PanelSection
              title="무결성 확인"
              icon={integrity.ok ? <ShieldCheck size={16} className="text-low" /> : <ShieldX size={16} className="text-high" />}
            >
              <IntegrityCheck result={integrity} receivedHash={context.planHash} />
            </PanelSection>
          )}
          {request.approvalStatus.length > 0 && (
            <PanelSection
              title="결재란"
              icon={<Stamp size={16} />}
              aside={
                <span className="text-xs text-ink-3 tabular-nums">
                  {stampsDone}/{request.approvalStatus.length} 완료
                </span>
              }
            >
              <StampSheet statuses={request.approvalStatus} tasks={tasks} stampedBy={stampedBy} />
            </PanelSection>
          )}
        </div>

        {context && integrity && (
          <div className="flex flex-col gap-2.5 border-t border-rule-strong bg-sheet p-4 shadow-[0_-4px_12px_rgb(16_26_46/0.06)]">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-[0.875rem] font-semibold">{docMode ? '적용 여부 결정' : '승인'}</h2>
              {selectedTasks.length > 0 && <span className="text-xs text-ink-3">선택한 작업 {selectedTasks.length}개</span>}
            </div>
            {selectedTasks.length > 0 && (
              <ul className="flex flex-col gap-0.5 text-[0.8125rem]">
                {selectedTasks.map((task) => (
                  <li key={task.id} className="truncate" title={task.title}>
                    <span className="mr-1.5 font-mono text-xs text-ink-3">{task.id}</span>
                    {task.title}
                  </li>
                ))}
              </ul>
            )}

            {runState && <SignProgress step={step} state={runState} />}
            {signError && (
              <Banner tone="danger" title="서명을 제출하지 못했습니다">
                {signError}
              </Banner>
            )}
            {result && result.response.status === 'VERIFICATION_FAILED' && (
              <Banner tone="danger" title="실행기가 승인 서명 검증에 실패했습니다">
                실행하지 않았습니다.{' '}
                <Link to={`/requests/${requestId}`} className="font-medium underline">
                  실패 항목 보기
                </Link>
              </Banner>
            )}
            {result && result.response.status !== 'VERIFICATION_FAILED' && (
              <div className="flex items-center gap-3 rounded-lg bg-seal-soft p-2.5">
                <ResultSeal label={result.doc ? '적용' : '승인'} />
                <div className="min-w-0 text-[0.8125rem] text-seal-dark">
                  {result.response.executionRequested ? (
                    <>
                      <p className="font-semibold">필요한 승인이 모두 모여 실행을 요청했습니다</p>
                      <Link to={`/requests/${requestId}`} className="font-medium underline">
                        실행 로그 보기
                      </Link>
                    </>
                  ) : (
                    <>
                      <p className="font-semibold">{result.doc ? '적용으로 처리했습니다' : '승인 서명을 제출했습니다'}</p>
                      <p>{nothingLeft ? '' : '다른 작업의 승인이 모이면 실행을 요청합니다.'}</p>
                    </>
                  )}
                </div>
              </div>
            )}
            {result && nextRequestId && (
              <Link
                to={`/approvals/${nextRequestId}`}
                className="inline-flex items-center justify-center gap-1 text-[0.8125rem] font-medium text-seal hover:underline"
              >
                다음 승인 대기 열기
                <ArrowRight size={14} aria-hidden />
              </Link>
            )}

            {signBlockedReason && !result && <p className="text-[0.8125rem] text-ink-2">{signBlockedReason}</p>}

            <Button
              variant="primary"
              size="lg"
              className="w-full"
              disabled={Boolean(signBlockedReason)}
              loading={sign.isPending}
              onClick={() => sign.mutate(selected)}
            >
              {approveLabel}
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="danger-outline"
                className="w-full"
                disabled={selected.length === 0 || sign.isPending || !accepting}
                onClick={() => setDecision('reject')}
              >
                {rejectLabel}
              </Button>
              <Button
                className="w-full"
                disabled={selected.length === 0 || sign.isPending || !accepting}
                onClick={() => setDecision('change')}
              >
                수정 요청
              </Button>
            </div>
            <p className="text-xs text-ink-3">서명은 이 기기의 승인 키로 하고, 실행기만 열어 볼 수 있게 암호화해 보냅니다.</p>
          </div>
        )}
      </aside>

      <ReasonModal
        open={decision === 'reject'}
        title={docMode ? '문서를 적용하지 않습니다' : '작업을 거부합니다'}
        description="선택한 작업을 거부하면 요청 전체가 거부 상태가 되고 요청자에게 알립니다."
        label="사유"
        placeholder="거부하는 이유를 적어 주세요"
        confirmLabel={rejectLabel}
        loading={decide.isPending}
        onConfirm={(reason) => decide.mutate({ reason, kind: 'reject' })}
        onClose={() => setDecision(null)}
      />
      <ReasonModal
        open={decision === 'change'}
        title="수정을 요청합니다"
        description="요청은 거부 상태가 되고, 적은 내용이 요청자에게 전달됩니다. 요청자는 내용을 반영해 새로 요청합니다."
        label="수정할 내용"
        placeholder="어떻게 고치면 되는지 적어 주세요"
        confirmLabel="수정 요청"
        danger={false}
        loading={decide.isPending}
        onConfirm={(reason) => decide.mutate({ reason, kind: 'change' })}
        onClose={() => setDecision(null)}
      />
    </>
  )
}
