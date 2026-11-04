import { useMutation } from '@tanstack/react-query'
import { Loader2, MessageCircleQuestion, Sparkles } from 'lucide-react'
import { useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { useMe } from '../../app/AuthProvider'
import { requestsApi } from '../../api/endpoints'
import type { RequestDetail, Risk } from '../../api/types'
import { RiskBadge } from '../../components/badges'
import { Stepper, type Step } from '../../components/RequestStepper'
import { TaskCard } from '../../components/TaskCard'
import { Button, ErrorState, Field, PageHeader, Select, Sheet, Spinner, TextArea } from '../../components/ui'
import { useProjects, useRefreshAll, useRequest } from '../../lib/queries'
import { ApprovalBasicsCard, ProjectSummaryCard, RecentRequestsCard } from './ComposeRail'
import { AnalysisFailedPanel, RequestMeta, TaskEditButtons } from './RequestParts'
import { SubmitPanel } from './SubmitPanel'
import { usePatchPlan } from './useRequestActions'

const RAIL_LAYOUT = 'grid grid-cols-[minmax(0,1fr)_360px] items-start gap-4'

/** 예시 문장과 보통 나뉘는 작업의 위험도. 어떤 요청이 어떤 승인을 거치는지 미리 감을 잡게 한다. */
const EXAMPLES: Array<{ text: string; risks: Risk[]; note: string }> = [
  { text: '로그인 실패 시 에러 메시지를 바꾸고 스테이징에 배포해줘', risks: ['MEDIUM', 'HIGH'], note: '코드 수정과 배포' },
  { text: '로그인 테스트를 보강해줘', risks: ['LOW'], note: '테스트 코드' },
  { text: 'README에 장애 대응 절차를 적어줘', risks: ['LOW'], note: '문서' },
  { text: '최근 7일 로그인 시도 통계를 조회해줘', risks: ['MEDIUM'], note: '데이터 조회' },
  { text: '스테이징 DB에 last_login_at 컬럼을 추가하는 마이그레이션을 돌려줘', risks: ['HIGH'], note: 'DB 접근' },
  { text: '세션 만료 시간을 30분으로 늘려줘', risks: ['HIGH'], note: 'AI가 위험도를 올리는 인증 변경' },
]

const FLOW: Step[] = [
  { key: 'prompt', label: '프롬프트 입력', hint: '할 일을 문장으로', state: 'current' },
  { key: 'analysis', label: 'AI 분석', hint: '작업, 위험도, 승인권자', state: 'todo' },
  { key: 'submit', label: '내가 확인하고 제출', hint: '1차 확인', state: 'todo' },
  { key: 'approve', label: '승인 서명', hint: '권한에 맞는 승인권자', state: 'todo' },
  { key: 'verify', label: '실행기 검증', hint: '서명과 해시를 다시 확인', state: 'todo' },
  { key: 'run', label: '공용 서버 실행', hint: '실시간 로그', state: 'todo' },
]

function PromptForm() {
  const navigate = useNavigate()
  const refresh = useRefreshAll()
  const projects = useProjects()
  const [selected, setSelected] = useState('')
  const [prompt, setPrompt] = useState('')
  const promptBox = useRef<HTMLDivElement>(null)
  const projectId = selected || projects.data?.[0]?.id || ''

  const create = useMutation({
    mutationFn: () => requestsApi.create({ projectId, prompt: prompt.trim() }),
    onSuccess: async ({ id }) => {
      await refresh()
      navigate(`/requests/new/${id}`)
    },
  })

  return (
    <>
      <PageHeader
        title="작업 요청"
        description="할 일을 문장으로 적으면 AI가 작업 단위로 나누고, 작업별 위험도와 승인권자를 알려 줍니다. 제출하고 승인을 받기 전에는 아무것도 실행되지 않습니다."
      />
      {/* 왼쪽을 오른쪽 안내 높이까지 늘려 입력란을 넓게 쓴다 */}
      <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-4">
        <div className="flex min-w-0 flex-col gap-4">
          <Sheet className="flex flex-1 flex-col [&>div]:flex [&>div]:flex-1 [&>div]:flex-col">
            <form
              className="flex flex-1 flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault()
                if (prompt.trim() && projectId) create.mutate()
              }}
            >
              <div className="max-w-xs">
                <Field label="프로젝트">
                  {(id) => (
                    <Select id={id} value={projectId} onChange={(event) => setSelected(event.target.value)}>
                      {projects.data?.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
              <div ref={promptBox} className="flex min-h-40 flex-1 flex-col [&>div]:flex-1 [&_textarea]:flex-1">
                <Field label="프롬프트">
                  {(id) => (
                    <TextArea
                      id={id}
                      rows={6}
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      placeholder="로그인 실패 시 에러 메시지를 바꾸고 스테이징에 배포해줘"
                      className="resize-y !text-[0.9375rem] leading-relaxed"
                    />
                  )}
                </Field>
              </div>
              <div>
                <p className="mb-1.5 text-[0.8125rem] font-medium text-ink-2">이렇게 적어 보세요</p>
                <div className="grid grid-cols-3 gap-2">
                  {EXAMPLES.map((example) => (
                    <button
                      key={example.text}
                      type="button"
                      onClick={() => {
                        setPrompt(example.text)
                        promptBox.current?.querySelector('textarea')?.focus()
                      }}
                      className="flex flex-col items-start gap-1.5 rounded-lg border border-rule bg-sheet-alt px-3 py-2 text-left hover:border-seal hover:bg-seal-soft"
                    >
                      <span className="text-[0.8125rem] leading-snug font-medium text-ink">{example.text}</span>
                      <span className="mt-auto flex flex-wrap items-center gap-1.5">
                        {example.risks.map((risk) => (
                          <RiskBadge key={risk} risk={risk} />
                        ))}
                        <span className="text-xs text-ink-3">{example.note}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-4">
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  loading={create.isPending}
                  disabled={!prompt.trim() || !projectId}
                  disabledReason="프로젝트를 고르고 프롬프트를 입력해 주세요"
                >
                  <Sparkles size={16} aria-hidden />
                  AI 분석 요청
                </Button>
                <p className="text-[0.8125rem] text-ink-3">분석 결과를 확인하고 고칠 수 있습니다. 바로 실행되지 않습니다.</p>
              </div>
            </form>
          </Sheet>
          <section aria-label="요청이 처리되는 순서" className="rounded-xl border border-rule bg-sheet px-4 py-4 shadow-card">
            <Stepper steps={FLOW} />
          </section>
        </div>
        <aside aria-label="요청 안내" className="flex flex-col gap-3">
          {projectId && <ProjectSummaryCard projectId={projectId} />}
          <ApprovalBasicsCard />
          <RecentRequestsCard />
        </aside>
      </div>
    </>
  )
}

function ClarificationForm({ request }: { request: RequestDetail }) {
  const [answer, setAnswer] = useState('')
  const patch = usePatchPlan(request.id)
  return (
    <Sheet title="AI가 확인을 요청했습니다" icon={<MessageCircleQuestion size={15} className="text-ai" aria-hidden />}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (answer.trim()) patch.mutate({ answer: answer.trim() })
        }}
      >
        <p className="rounded-lg bg-ai-soft/60 px-3 py-2.5 text-sm text-ink">{request.clarification?.question}</p>
        <Field label="답변">
          {(id) => <TextArea id={id} rows={4} value={answer} onChange={(event) => setAnswer(event.target.value)} />}
        </Field>
        <div>
          <Button
            type="submit"
            variant="primary"
            loading={patch.isPending}
            disabled={!answer.trim()}
            disabledReason="답변을 입력해 주세요"
          >
            답변 보내기
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

/** 분석 결과가 오기 전에 자리를 잡아 둔다. 화면이 갑자기 튀지 않게 한다. */
function AnalyzingPlaceholder() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5 rounded-xl border border-ai/25 bg-ai-soft/40 px-4 py-3 text-sm text-ink-2" role="status">
        <Loader2 size={18} className="animate-spin text-ai" aria-hidden />
        AI가 프롬프트를 작업 단위로 나누고 위험도를 매기는 중입니다.
      </div>
      {[0, 1].map((key) => (
        <div key={key} aria-hidden className="flex animate-pulse flex-col gap-2.5 rounded-xl border border-rule bg-sheet p-4">
          <div className="h-4 w-1/3 rounded bg-paper" />
          <div className="h-3 w-1/2 rounded bg-paper" />
          <div className="h-20 rounded-lg bg-paper" />
        </div>
      ))}
    </div>
  )
}

function PlanCards({ request }: { request: RequestDetail }) {
  const tasks = request.plan?.tasks ?? []
  const blockedCount = tasks.filter((task) => task.status === 'BLOCKED').length
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-1.5 text-sm text-ink-2">
        <Sparkles size={15} className="text-ai" aria-hidden />
        AI가 작업 {tasks.length}개로 나눴습니다.
        {blockedCount > 0 && ` 이 중 ${blockedCount}개는 금지 작업이라 실행되지 않습니다.`}
      </p>
      {tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          requestId={request.id}
          showStatus={false}
          actions={<TaskEditButtons task={task} request={request} />}
        />
      ))}
    </div>
  )
}

function ReviewStep({ requestId }: { requestId: string }) {
  const me = useMe()
  const query = useRequest(requestId)
  if (query.isPending) return <Spinner />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  const request = query.data

  // 이 화면은 요청자가 제출하기 전까지만 쓴다. 그 뒤는 요청 상세에서 이어 간다.
  const inCompose = ['ANALYZING', 'ANALYSIS_FAILED', 'REVIEWING'].includes(request.status)
  if (!inCompose || request.requester.id !== me.id) return <Navigate to={`/requests/${request.id}`} replace />
  const reviewing = request.status === 'REVIEWING' && !request.clarification

  return (
    <>
      <PageHeader title={request.prompt} meta={<RequestMeta request={request} />} />
      <div className={RAIL_LAYOUT}>
        <div className="min-w-0">
          {request.status === 'ANALYZING' && <AnalyzingPlaceholder />}
          {request.status === 'ANALYSIS_FAILED' && <AnalysisFailedPanel request={request} isRequester />}
          {request.status === 'REVIEWING' && request.clarification && <ClarificationForm request={request} />}
          {reviewing && <PlanCards request={request} />}
        </div>
        {reviewing ? (
          <SubmitPanel request={request} />
        ) : (
          <aside aria-label="요청 안내" className="flex flex-col gap-3">
            <ProjectSummaryCard projectId={request.projectId} />
            <ApprovalBasicsCard />
          </aside>
        )}
      </div>
    </>
  )
}

export default function ComposePage() {
  const { requestId } = useParams()
  return requestId ? <ReviewStep requestId={requestId} /> : <PromptForm />
}
