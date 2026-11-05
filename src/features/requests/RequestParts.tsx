import { useState } from 'react'
import { useNavigate } from 'react-router'
import { USE_MOCK } from '../../api/client'
import type { RequestDetail, Task } from '../../api/types'
import { Banner, Button, ConfirmModal, ReasonModal } from '../../components/ui'
import { formatDateTime } from '../../lib/format'
import { useProjects, useRequest } from '../../lib/queries'
import { taskDeleteTitle, taskEditTitle } from '../../lib/taskLabel'
import { useCancelRequest, usePatchPlan, useRetryAnalysis } from './useRequestActions'

const MAX_ANALYSIS_ATTEMPTS = 3

/** 조용한 메타 한 줄: 프로젝트, 요청자, 시각 */
export function RequestMeta({ request }: { request: RequestDetail }) {
  const projects = useProjects()
  // 프로젝트 이름은 서버의 요청 응답에 없어 프로젝트 목록에서 찾는다.
  const projectName = projects.data?.find((project) => project.id === request.projectId)?.name ?? request.projectId
  const parts = [projectName, request.requester.name, formatDateTime(request.createdAt)]
  if (request.currentPlan?.kind === 'ROLLBACK') parts.push('문서 롤백')
  return <span className="text-ink-3">{parts.join(', ')}</span>
}

/** 작업별 수정(지시 문장 입력)·삭제. 어느 쪽이든 PATCH 후 AI가 다시 분석한다. */
export function TaskEditButtons({
  task,
  request,
  voidsApprovals,
}: {
  task: Task
  request: RequestDetail
  /** 승인 대기 이후의 수정이면 기존 서명이 무효가 된다고 미리 알린다 */
  voidsApprovals?: boolean
}) {
  const [mode, setMode] = useState<'edit' | 'delete' | null>(null)
  const patch = usePatchPlan(request.id)
  const close = () => setMode(null)
  const warning = voidsApprovals ? '수정하면 AI가 다시 분석하고, 기존 승인 서명은 모두 무효가 되어 재승인이 필요합니다.' : null
  const basePlanId = request.currentPlanId ?? undefined

  return (
    <>
      {task.risk !== 'FORBIDDEN' && (
        <Button size="sm" variant="ghost" internalOnly onClick={() => setMode('edit')}>
          수정
        </Button>
      )}
      <Button size="sm" variant="ghost" internalOnly onClick={() => setMode('delete')}>
        삭제
      </Button>

      <ReasonModal
        open={mode === 'edit'}
        title={taskEditTitle(task)}
        description={warning ?? 'AI에게 어떻게 고칠지 문장으로 알려 주세요. 수정하면 Plan을 다시 분석합니다.'}
        label="수정 지시"
        placeholder="메시지를 한국어와 영어 둘 다 보여줘"
        confirmLabel="수정 지시 보내기"
        danger={false}
        loading={patch.isPending}
        onClose={close}
        onConfirm={(instruction) =>
          patch.mutate(
            { basePlanId, changes: [{ op: 'UPDATE', taskId: task.id, instruction }] },
            { onSuccess: close },
          )
        }
      />
      <ConfirmModal
        open={mode === 'delete'}
        title={taskDeleteTitle(task)}
        confirmLabel="작업 삭제"
        danger
        loading={patch.isPending}
        onClose={close}
        onConfirm={() =>
          patch.mutate({ basePlanId, changes: [{ op: 'DELETE', taskId: task.id }] }, { onSuccess: close })
        }
      >
        <p className="font-medium text-ink">{task.title}</p>
        <p className="mt-1">{warning ?? '이 작업을 Plan에서 빼고 다시 분석합니다.'}</p>
      </ConfirmModal>
    </>
  )
}

export function CancelRequestButton({
  requestId,
  onDone,
  size,
}: {
  requestId: string
  onDone?: () => void
  size?: 'md' | 'lg'
}) {
  const [open, setOpen] = useState(false)
  const cancel = useCancelRequest(requestId, onDone)
  return (
    <>
      <Button size={size} onClick={() => setOpen(true)}>
        요청 취소
      </Button>
      <ConfirmModal
        open={open}
        title="요청을 취소할까요?"
        confirmLabel="요청 취소"
        danger
        loading={cancel.isPending}
        onClose={() => setOpen(false)}
        onConfirm={() => cancel.mutate(undefined, { onSuccess: () => setOpen(false) })}
      >
        취소한 요청은 되살릴 수 없습니다. 같은 작업이 필요하면 새로 요청해 주세요.
      </ConfirmModal>
    </>
  )
}

/**
 * 분석이 끝나지 않을 때. 진행 중인 것처럼 보이는 표시를 치우고 있는 그대로 말한다.
 * 서버는 분석 중인 요청의 취소도 재시도도 받지 않아(RequestService.CANCELABLE, RequestPlanService.retryAnalysis) 그런 버튼을 두지 않는다.
 */
export function AnalysisOverdueBanner({ requestId }: { requestId: string }) {
  const navigate = useNavigate()
  const query = useRequest(requestId)
  return (
    <Banner
      tone="warning"
      title="분석이 평소보다 오래 걸리고 있습니다"
      action={
        <div className="flex items-center gap-2">
          <Button onClick={() => navigate('/requests')}>요청 목록</Button>
          <Button loading={query.isFetching} onClick={() => void query.refetch()}>
            지금 다시 확인
          </Button>
        </div>
      }
    >
      <p>아직 결과가 없고 언제 끝날지 알 수 없습니다. 이 화면을 떠나도 요청은 남아 있으니 나중에 다시 확인해 주세요.</p>
      <p className="mt-1">분석 중인 요청은 취소할 수 없습니다. 계속 끝나지 않으면 관리자에게 알려 주세요.</p>
    </Banner>
  )
}

/** 분석 실패: 3회까지 재시도, 남은 횟수 표시 */
export function AnalysisFailedPanel({ request, isRequester }: { request: RequestDetail; isRequester: boolean }) {
  const retry = useRetryAnalysis(request.id)
  const navigate = useNavigate()
  const remaining = Math.max(0, MAX_ANALYSIS_ATTEMPTS - request.analysisAttempts)
  return (
    <Banner
      tone="danger"
      title="AI 분석에 실패했습니다"
      action={
        isRequester && (
          <div className="flex items-center gap-2">
            {/* 목은 분석 실패 취소를 받지 않는다. */}
            {!USE_MOCK && <CancelRequestButton requestId={request.id} onDone={() => navigate('/requests')} />}
            {remaining > 0 ? (
              <Button variant="primary" internalOnly loading={retry.isPending} onClick={() => retry.mutate()}>
                다시 분석
              </Button>
            ) : (
              <Button variant="primary" internalOnly onClick={() => navigate('/requests/new')}>
                새로 요청
              </Button>
            )}
          </div>
        )
      }
    >
      <p>AI 분석 엔진에서 결과를 받지 못했습니다.</p>
      <p className="mt-1">
        {remaining > 0
          ? `남은 재시도 ${remaining}회`
          : '재시도 횟수(3회)를 모두 썼습니다. 프롬프트를 고쳐 새로 요청해 주세요.'}
      </p>
    </Banner>
  )
}
