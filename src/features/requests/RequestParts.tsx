import { Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import type { RequestDetail, Task } from '../../api/types'
import { RequestStatusBadge } from '../../components/badges'
import { Avatar, ProjectTag } from '../../components/rich'
import { Banner, Button, ConfirmModal, ReasonModal } from '../../components/ui'
import { formatDateTime, formatElapsed } from '../../lib/format'
import { SOURCE_LABEL } from '../../lib/labels'
import { useDepartmentNames } from '../../lib/queries'
import { useCancelRequest, usePatchPlan, useRetryAnalysis } from './useRequestActions'

const MAX_ANALYSIS_ATTEMPTS = 3

export function RequestMeta({ request }: { request: RequestDetail }) {
  const departmentName = useDepartmentNames()
  return (
    <>
      <RequestStatusBadge status={request.status} />
      <ProjectTag name={request.projectName} />
      <span className="inline-flex items-center gap-1.5">
        <Avatar name={request.requester.name} size="sm" />
        요청자 {request.requester.name}
        <span className="text-ink-3">{departmentName(request.requester.departmentId)}</span>
      </span>
      <span className="text-ink-3">
        {formatDateTime(request.createdAt)} ({formatElapsed(request.createdAt)} 전)
      </span>
      {request.source !== 'PROMPT' && <span className="text-ink-3">{SOURCE_LABEL[request.source]}에서 만듦</span>}
    </>
  )
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
          <Pencil size={13} aria-hidden />
          수정
        </Button>
      )}
      <Button size="sm" variant="ghost" internalOnly onClick={() => setMode('delete')}>
        <Trash2 size={13} aria-hidden />
        삭제
      </Button>

      <ReasonModal
        open={mode === 'edit'}
        title={`${task.id} 작업 수정`}
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
        title={`${task.id} 작업 삭제`}
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
  fullWidth,
}: {
  requestId: string
  onDone?: () => void
  fullWidth?: boolean
}) {
  const [open, setOpen] = useState(false)
  const cancel = useCancelRequest(requestId, onDone)
  return (
    <>
      <Button variant="danger-outline" className={fullWidth ? 'w-full' : ''} onClick={() => setOpen(true)}>
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
        isRequester &&
        (remaining > 0 ? (
          <Button variant="primary" internalOnly loading={retry.isPending} onClick={() => retry.mutate()}>
            다시 분석
          </Button>
        ) : (
          <Button variant="primary" internalOnly onClick={() => navigate('/requests/new')}>
            새로 요청
          </Button>
        ))
      }
    >
      <p>{request.analysisError ?? 'AI 분석 엔진에서 결과를 받지 못했습니다.'}</p>
      <p className="mt-1">
        {remaining > 0
          ? `남은 재시도 ${remaining}회`
          : '재시도 횟수(3회)를 모두 썼습니다. 프롬프트를 고쳐 새로 요청해 주세요.'}
      </p>
    </Banner>
  )
}
