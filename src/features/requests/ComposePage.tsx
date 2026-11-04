import { useMutation } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { useMe } from '../../app/AuthProvider'
import { requestsApi } from '../../api/endpoints'
import type { RequestDetail } from '../../api/types'
import { TaskCard } from '../../components/TaskCard'
import { Banner, Button, ErrorState, Field, PageHeader, Select, Sheet, Spinner, TextArea } from '../../components/ui'
import { useProjects, useRefreshAll, useRequest } from '../../lib/queries'
import { AnalysisFailedPanel, CancelRequestButton, RequestMeta, TaskEditButtons } from './RequestParts'
import { usePatchPlan, useSubmitRequest } from './useRequestActions'

function PromptForm() {
  const navigate = useNavigate()
  const refresh = useRefreshAll()
  const projects = useProjects()
  const [selected, setSelected] = useState('')
  const [prompt, setPrompt] = useState('')
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
      <Sheet>
        <form
          className="flex max-w-3xl flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (prompt.trim() && projectId) create.mutate()
          }}
        >
          <Field label="프로젝트">
            {(id) => (
              <Select id={id} value={projectId} onChange={(event) => setSelected(event.target.value)} className="max-w-xs">
                {projects.data?.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="프롬프트">
            {(id) => (
              <TextArea
                id={id}
                rows={5}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="로그인 실패 시 에러 메시지를 바꾸고 스테이징에 배포해줘"
              />
            )}
          </Field>
          <div>
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
      </Sheet>
    </>
  )
}

function ClarificationForm({ request }: { request: RequestDetail }) {
  const [answer, setAnswer] = useState('')
  const patch = usePatchPlan(request.id)
  return (
    <Sheet title="AI가 확인을 요청했습니다">
      <form
        className="flex max-w-3xl flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (answer.trim()) patch.mutate({ answer: answer.trim() })
        }}
      >
        <p className="text-sm">{request.clarification?.question}</p>
        <Field label="답변">
          {(id) => <TextArea id={id} rows={3} value={answer} onChange={(event) => setAnswer(event.target.value)} />}
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

function PlanReview({ request }: { request: RequestDetail }) {
  const navigate = useNavigate()
  const submit = useSubmitRequest(request.id, () => navigate(`/requests/${request.id}`))
  const tasks = request.plan?.tasks ?? []
  const runnable = tasks.filter((task) => task.status !== 'BLOCKED')
  const blockedCount = tasks.length - runnable.length
  const cannotSubmit = runnable.length === 0
  const reason =
    tasks.length === 0
      ? '남은 작업이 없습니다. 요청을 취소하거나 새로 요청해 주세요'
      : '금지 작업만 남아 있어 제출할 수 없습니다. 요청을 취소해 주세요'

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-2">
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
      {cannotSubmit && <Banner tone="warning">{reason}</Banner>}

      <Sheet>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            size="lg"
            loading={submit.isPending}
            disabled={cannotSubmit}
            disabledReason={reason}
            onClick={() => submit.mutate()}
          >
            제출
          </Button>
          <CancelRequestButton requestId={request.id} onDone={() => navigate('/requests')} />
          <p className="max-w-[60ch] text-[0.8125rem] text-ink-2">
            제출은 Plan을 확인했다는 1차 확인입니다. 실행하려면 승인권자의 승인 서명이 있어야 합니다. 본인 승인이 허용된
            작업은 제출과 함께 승인됩니다.
          </p>
        </div>
      </Sheet>
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

  return (
    <>
      <PageHeader title={request.prompt} meta={<RequestMeta request={request} />} />
      {request.status === 'ANALYZING' && (
        <Sheet>
          <div className="flex items-center gap-2.5 py-8 text-sm text-ink-2" role="status">
            <Loader2 size={18} className="animate-spin text-seal" aria-hidden />
            AI가 프롬프트를 작업 단위로 나누고 위험도를 매기는 중입니다.
          </div>
        </Sheet>
      )}
      {request.status === 'ANALYSIS_FAILED' && <AnalysisFailedPanel request={request} isRequester />}
      {request.status === 'REVIEWING' &&
        (request.clarification ? <ClarificationForm request={request} /> : <PlanReview request={request} />)}
    </>
  )
}

export default function ComposePage() {
  const { requestId } = useParams()
  return requestId ? <ReviewStep requestId={requestId} /> : <PromptForm />
}
