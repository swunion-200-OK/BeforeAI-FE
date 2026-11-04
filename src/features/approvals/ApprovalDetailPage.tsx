import { useMutation, useQuery } from '@tanstack/react-query'
import { Globe } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { approvalsApi } from '../../api/endpoints'
import { ApiError, errorMessage } from '../../api/errors'
import type { Plan, Risk, SubmitApprovalResponse, Task, TaskApprovalStatus } from '../../api/types'
import { useMe } from '../../app/AuthProvider'
import { ApprovalStamps, approvalSummary } from '../../components/ApprovalStamps'
import { RequestStatusBadge, RiskBadge } from '../../components/badges'
import { TaskCard } from '../../components/TaskCard'
import { toast } from '../../components/toast'
import { Banner, Button, ErrorState, Mono, PageHeader, ReasonModal, Sheet, Spinner } from '../../components/ui'
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

const RISK_ORDER: Risk[] = ['HIGH', 'MEDIUM', 'LOW', 'FORBIDDEN']

type DecisionKind = 'reject' | 'change'

function PlanSummary({ plan }: { plan: Plan }) {
  const counts = RISK_ORDER.map((risk) => ({ risk, count: plan.tasks.filter((t) => t.risk === risk).length })).filter(
    (item) => item.count > 0,
  )
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[0.8125rem]">
      <dt className="text-ink-3">작업</dt>
      <dd className="flex flex-wrap items-center gap-2">
        <span>{plan.tasks.length}개</span>
        {counts.map(({ risk, count }) => (
          <span key={risk} className="inline-flex items-center gap-1">
            <RiskBadge risk={risk} />
            {count}
          </span>
        ))}
      </dd>
      <dt className="text-ink-3">저장소</dt>
      <dd>
        <Mono>{plan.repository}</Mono>
      </dd>
      <dt className="text-ink-3">기준 커밋</dt>
      <dd>
        <Mono>{plan.baseCommit}</Mono>
      </dd>
      {plan.kind === 'ROLLBACK' && (
        <>
          <dt className="text-ink-3">종류</dt>
          <dd>문서 롤백 Plan</dd>
        </>
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

function ApprovalDetail({ requestId }: { requestId: string }) {
  const me = useMe()
  const departmentName = useDepartmentNames()
  const refreshAll = useRefreshAll()
  const requestQuery = useRequest(requestId)
  const contextQuery = useQuery({
    queryKey: ['approval-context', requestId],
    queryFn: () => approvalsApi.context(requestId),
  })

  const [deselected, setDeselected] = useState<ReadonlySet<string>>(new Set())
  const [step, setStep] = useState<SignStep | null>(null)
  const [runState, setRunState] = useState<SignRunState | null>(null)
  const [signError, setSignError] = useState<string | null>(null)
  const [result, setResult] = useState<{ response: SubmitApprovalResponse; doc: boolean } | null>(null)
  const [stampedBy, setStampedBy] = useState<string | undefined>()
  const [decision, setDecision] = useState<DecisionKind | null>(null)

  const context = contextQuery.data
  const request = requestQuery.data
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
  const keyReady = me.signingKeyStatus === 'REGISTERED' && signingService.hasDeviceKey(me.id)

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

  if (requestQuery.isPending) return <Spinner />
  if (requestQuery.isError) return <ErrorState error={requestQuery.error} onRetry={() => requestQuery.refetch()} />
  if (!request) return null

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

  let signBlockedReason: string | null = null
  if (integrity && !integrity.ok) signBlockedReason = 'Plan 무결성 확인에 실패해 서명할 수 없습니다.'
  else if (!keyReady) signBlockedReason = '승인 키를 등록해야 서명할 수 있습니다.'
  else if (approvable.length === 0) signBlockedReason = '지금 내가 승인할 수 있는 작업이 없습니다.'
  else if (selected.length === 0) signBlockedReason = '승인할 작업을 고르세요.'

  const approveLabel = docMode ? '적용' : '승인(서명)'
  const rejectLabel = docMode ? '미적용' : '거부'

  return (
    <>
      <PageHeader
        title="승인 상세"
        meta={
          <>
            <RequestStatusBadge status={request.status} />
            <span>{request.projectName}</span>
            <span>
              요청자 {request.requester.name} ({departmentName(request.requester.departmentId)})
            </span>
            <span>{formatDateTime(request.createdAt)}</span>
            {request.source !== 'PROMPT' && <span>{SOURCE_LABEL[request.source]}</span>}
          </>
        }
        actions={
          <Link to={`/requests/${requestId}`} className="text-sm font-medium text-seal hover:underline">
            요청 상세 보기
          </Link>
        }
      />

      <div className="mb-4 flex flex-col gap-3 empty:hidden">
        {expectedContextError && <ContextNotice error={contextError} requestId={requestId} />}
        {contextQuery.isError && !expectedContextError && (
          <ErrorState error={contextError} onRetry={() => contextQuery.refetch()} />
        )}
        {context && !keyReady && (
          <Banner
            tone="warning"
            title="승인 키 등록 필요"
            action={
              <Link to="/me" className="font-medium underline">
                내 정보로 이동
              </Link>
            }
          >
            {me.signingKeyStatus === 'PENDING'
              ? '승인 키가 관리자 등록을 기다리고 있습니다. 등록된 뒤 서명할 수 있습니다.'
              : me.signingKeyStatus === 'REGISTERED'
                ? '이 기기에 승인 키가 없습니다. 키를 만든 기기에서 서명하거나 이 기기에서 새로 등록해 주세요.'
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
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <Sheet title="원본 프롬프트">
            <p className="max-w-[70ch] text-[0.9375rem] whitespace-pre-wrap">{request.prompt}</p>
          </Sheet>

          {(context?.plan ?? request.plan) && (
            <Sheet title="Plan 요약">
              <PlanSummary plan={(context?.plan ?? request.plan) as Plan} />
            </Sheet>
          )}

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
                  context && task.risk !== 'FORBIDDEN' ? (
                    <input
                      type="checkbox"
                      className="size-4 accent-seal disabled:cursor-not-allowed"
                      aria-label={`${task.title} 승인 대상으로 선택`}
                      checked={canApprove && !deselected.has(task.id)}
                      disabled={!canApprove}
                      title={isBlocked ? '내부망 승인 필요' : canApprove ? undefined : '지금 내가 승인할 수 없는 작업입니다'}
                      onChange={() => toggle(task.id)}
                    />
                  ) : undefined
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

        {context && integrity && (
          <aside className="order-first flex min-w-0 flex-col gap-4 xl:sticky xl:top-0 xl:order-last xl:max-h-[calc(100dvh-5.5rem)] xl:overflow-x-hidden xl:overflow-y-auto">
            <Sheet title="무결성 확인">
              <IntegrityCheck result={integrity} receivedHash={context.planHash} />
            </Sheet>

            <Sheet title="결재란" flush>
              <ul className="divide-y divide-rule">
                {request.approvalStatus.map((status) => {
                  const task = tasks.find((t) => t.id === status.taskId)
                  return (
                    <li key={status.taskId} className="flex flex-col gap-2 p-4">
                      <p className="text-[0.8125rem] font-medium">
                        <span className="mr-1.5 font-mono text-xs font-normal text-ink-3">{status.taskId}</span>
                        {task?.title}
                      </p>
                      <div className="overflow-x-auto">
                        <ApprovalStamps status={status} justStampedBy={stampedBy} />
                      </div>
                    </li>
                  )
                })}
              </ul>
            </Sheet>

            <Sheet title={docMode ? '적용 여부 결정' : '승인'}>
              <div className="flex flex-col gap-3">
                {selectedTasks.length > 0 ? (
                  <div className="text-[0.8125rem]">
                    <p className="text-ink-3">선택한 작업 {selectedTasks.length}개</p>
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {selectedTasks.map((task) => (
                        <li key={task.id} className="truncate">
                          <span className="mr-1.5 font-mono text-xs text-ink-3">{task.id}</span>
                          {task.title}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

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
                {result && result.response.executionRequested && result.response.status !== 'VERIFICATION_FAILED' && (
                  <Banner tone="info" title="필요한 승인이 모두 모여 실행을 요청했습니다">
                    <Link to={`/requests/${requestId}`} className="font-medium underline">
                      실행 로그 보기
                    </Link>
                  </Banner>
                )}
                {result && !result.response.executionRequested && (
                  <Banner tone="info" title={result.doc ? '적용으로 처리했습니다' : '승인 서명을 제출했습니다'}>
                    다른 작업의 승인이 모이면 실행을 요청합니다.
                  </Banner>
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
                    disabled={selected.length === 0 || sign.isPending}
                    onClick={() => setDecision('reject')}
                  >
                    {rejectLabel}
                  </Button>
                  <Button
                    className="w-full"
                    disabled={selected.length === 0 || sign.isPending}
                    onClick={() => setDecision('change')}
                  >
                    수정 요청
                  </Button>
                </div>
                <p className="text-xs text-ink-3">서명은 이 기기의 승인 키로 하고, 실행기만 열어 볼 수 있게 암호화해 보냅니다.</p>
              </div>
            </Sheet>
          </aside>
        )}
      </div>

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

export default function ApprovalDetailPage() {
  const { requestId } = useParams()
  if (!requestId) return null
  // 다른 요청으로 옮겨 가면 선택·서명 진행 상태를 새로 시작한다.
  return <ApprovalDetail key={requestId} requestId={requestId} />
}
