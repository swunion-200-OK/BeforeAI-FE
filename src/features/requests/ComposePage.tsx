import { useMutation, useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import { useMe } from '../../app/AuthProvider'
import { requestsApi } from '../../api/endpoints'
import type { RequestDetail } from '../../api/types'
import { TaskCard } from '../../components/TaskCard'
import { Button, ErrorState, Field, PageHeader, Select, Sheet, Spinner, TextArea } from '../../components/ui'
import { formatElapsed } from '../../lib/format'
import { REQUEST_STATUS_LABEL } from '../../lib/labels'
import { useIsExternal, useProjects, useRefreshAll, useRequest } from '../../lib/queries'
import { AnalysisFailedPanel, RequestMeta, TaskEditButtons } from './RequestParts'
import { pathFor } from './requestPaths'
import { SubmitBar } from './SubmitBar'
import { usePatchPlan } from './useRequestActions'

const EXAMPLES = ['로그인 테스트를 보강해줘', 'README에 장애 대응 절차를 적어줘', '세션 만료 시간을 30분으로 늘려줘']

function RecentRequests() {
  const external = useIsExternal()
  const recent = useQuery({
    queryKey: ['requests', 'recent-mine'],
    queryFn: async () => (await requestsApi.list({ mine: true, limit: 3 })).items,
  })
  if (!recent.data?.length) return null
  return (
    <section aria-label="최근 내 요청" className="mt-10">
      <h2 className="mb-2 px-2 text-sm font-semibold text-ink-2">최근 내 요청</h2>
      <ul>
        {recent.data.map((request) => (
          <li key={request.id}>
            <Link
              to={pathFor(request, external)}
              className="flex items-baseline gap-4 rounded-md px-2 py-2 text-base text-ink-2 hover:bg-sheet hover:text-ink"
            >
              <span className="min-w-0 flex-1 truncate">{request.prompt}</span>
              <span className="shrink-0 text-sm text-ink-3">
                {REQUEST_STATUS_LABEL[request.status]}, {formatElapsed(request.createdAt)} 전
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function PromptForm({ initialPrompt }: { initialPrompt: string }) {
  const navigate = useNavigate()
  const refresh = useRefreshAll()
  const projects = useProjects()
  const [selected, setSelected] = useState('')
  const [prompt, setPrompt] = useState(initialPrompt)
  const box = useRef<HTMLTextAreaElement>(null)
  const projectId = selected || projects.data?.[0]?.id || ''

  const create = useMutation({
    mutationFn: () => requestsApi.create({ projectId, prompt: prompt.trim() }),
    onSuccess: async ({ id }) => {
      await refresh()
      navigate(`/requests/new/${id}`)
    },
  })

  return (
    <div className="mx-auto max-w-[54rem] pt-[10vh]">
      <h1 className="mb-7 text-center text-[2rem] font-bold tracking-tight">AI에게 무엇을 맡길까요?</h1>
      <form
        className="rounded-2xl border border-rule-strong bg-sheet shadow-card focus-within:border-seal focus-within:ring-1 focus-within:ring-seal"
        onSubmit={(event) => {
          event.preventDefault()
          if (prompt.trim() && projectId) create.mutate()
        }}
      >
        <textarea
          ref={box}
          aria-label="프롬프트"
          rows={6}
          autoFocus
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="로그인 실패 시 에러 메시지를 바꾸고 스테이징에 배포해줘"
          className="block w-full resize-none rounded-t-2xl bg-transparent px-5 pt-4 text-base leading-relaxed text-ink placeholder:text-ink-3 focus:outline-none"
        />
        <div className="flex items-center justify-between gap-3 px-4 pt-2 pb-4">
          <Select
            aria-label="프로젝트"
            value={projectId}
            onChange={(event) => setSelected(event.target.value)}
            className="!w-56"
          >
            {projects.data?.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={create.isPending}
            disabled={!prompt.trim() || !projectId}
            disabledReason="프로젝트를 고르고 프롬프트를 입력해 주세요"
          >
            AI 분석 요청
          </Button>
        </div>
      </form>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => {
              setPrompt(example)
              box.current?.focus()
            }}
            className="rounded-full border border-rule bg-sheet px-3.5 py-1.5 text-sm text-ink-2 hover:border-seal hover:text-seal"
          >
            {example}
          </button>
        ))}
      </div>
      <RecentRequests />
    </div>
  )
}

function ClarificationForm({ request }: { request: RequestDetail }) {
  const [answer, setAnswer] = useState('')
  const patch = usePatchPlan(request.id)
  return (
    <Sheet title="AI가 확인을 요청했습니다">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (answer.trim()) patch.mutate({ answer: answer.trim() })
        }}
      >
        <p className="text-base text-ink">{request.clarification?.question}</p>
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

/** 분석 결과가 오기 전에 기다리는 이유와 다음에 볼 것을 알려 준다. 움직임은 돌아가는 표시 하나뿐이다. */
function AnalyzingPlaceholder() {
  return (
    <div role="status" className="flex flex-col items-center gap-3 rounded-xl border border-rule bg-sheet px-8 py-16 text-center">
      <Loader2 size={40} className="animate-spin text-seal" aria-hidden />
      <p className="mt-2 text-xl font-semibold">AI가 프롬프트를 작업 단위로 나누고 위험도를 매기는 중입니다.</p>
      <p className="text-base text-ink-2">끝나면 이 화면에 작업 목록이 나타납니다. 제출하기 전에 하나씩 확인하고 고칠 수 있습니다.</p>
    </div>
  )
}

function PlanCards({ request }: { request: RequestDetail }) {
  const tasks = request.plan?.tasks ?? []
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-2">AI가 작업 {tasks.length}개로 나눴습니다.</p>
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
    // 작업이 적어도 제출 막대가 화면 바닥에 붙도록 본문 높이를 채운다.
    // 84px = 망 띠 4px + 상단 바 56px + 본문 위 여백 24px. 아래 여백(pb-16)은 음수 여백으로 상쇄한다.
    <div className={`flex flex-col ${reviewing ? '-mb-16 min-h-[calc(100dvh-84px)]' : ''}`}>
      <PageHeader title={request.prompt} meta={<RequestMeta request={request} />} />
      <div className="flex-1">
        {request.status === 'ANALYZING' && <AnalyzingPlaceholder />}
        {request.status === 'ANALYSIS_FAILED' && <AnalysisFailedPanel request={request} isRequester />}
        {request.status === 'REVIEWING' && request.clarification && <ClarificationForm request={request} />}
        {reviewing && <PlanCards request={request} />}
      </div>
      {reviewing && <SubmitBar request={request} />}
    </div>
  )
}

export default function ComposePage() {
  const { requestId } = useParams()
  const [params] = useSearchParams()
  if (requestId) return <ReviewStep requestId={requestId} />
  // 개발 도구의 시연 가이드가 ?prompt=로 입력칸을 채운다. 이미 이 화면에 있어도 다시 채우도록 key를 건다.
  const initialPrompt = params.get('prompt') ?? ''
  return <PromptForm key={initialPrompt} initialPrompt={initialPrompt} />
}
