import { useMutation } from '@tanstack/react-query'
import { useMe } from '../../app/AuthProvider'
import { requestsApi } from '../../api/endpoints'
import type { PlanChange, RequestDetail } from '../../api/types'
import { toast } from '../../components/toast'
import { useRefreshAll } from '../../lib/queries'
import { submitWithSelfApproval, type ReviewedPlan, type SubmitOutcome } from '../approvals/approvalFlow'
import { executionDeferredText } from './statusBannerText'

/**
 * 제출 결과를 문구로 알린다. 제출(1차 확인)과 승인(2차)을 섞어 쓰지 않는다.
 * 본인 승인으로 승인이 다 모이면 그 자리에서 웹쉘이 검증하므로, 실패했는데 성공으로 알리지 않도록 상태를 다시 본다.
 */
async function announceSubmit(requestId: string, outcome: SubmitOutcome) {
  if (outcome.submit.status === 'COMPLETED') {
    toast.info('승인받을 작업이 남아 있지 않아 요청을 끝냈습니다')
    return
  }
  const approved = `제출과 함께 작업 ${outcome.selfApprovedTaskIds.length}건을 본인 승인했습니다`
  if (outcome.executionRequested) {
    const current = await requestsApi.get(requestId).catch(() => null)
    if (current?.status === 'VERIFICATION_FAILED') {
      toast.error(`${approved}. 하지만 웹쉘 검증에 실패해 실행하지 않았습니다. 실패 항목을 확인해 주세요`)
      return
    }
    toast.success(`${approved}. 필요한 승인이 모두 모여 실행을 요청했습니다`)
  } else if (outcome.executionDeferred) {
    toast.info(`${approved}. ${executionDeferredText()}`)
  } else if (outcome.selfApprovedTaskIds.length > 0) {
    toast.success(approved)
  } else if (outcome.selfApprovalSkipped) {
    toast.success('제출했습니다. 이 기기에 승인 키가 없어 본인 승인은 하지 않았습니다')
  } else {
    toast.success('제출했습니다. 승인권자의 승인을 기다립니다')
  }
  if (outcome.selfApprovalError) {
    toast.error(`제출은 됐지만 본인 승인은 하지 못했습니다: ${outcome.selfApprovalError}`)
  }
}

/** 지금 화면에 보여 준 내용. 본인 승인은 이것과 서명할 내용이 같을 때만 한다. */
function reviewedOf(request: Pick<RequestDetail, 'projectId' | 'currentPlan'>): ReviewedPlan | null {
  return request.currentPlan ? { projectId: request.projectId, tasks: request.currentPlan.tasks } : null
}

/** 제출·다시 제출. 본인 승인이 허용된 작업은 제출과 함께 승인까지 끝낸다. */
export function useSubmitRequest(request: RequestDetail, onDone?: () => void) {
  const requestId = request.id
  const me = useMe()
  const refresh = useRefreshAll()
  return useMutation({
    mutationFn: () => submitWithSelfApproval(me, requestId, reviewedOf(request)),
    onSuccess: async (outcome) => {
      await announceSubmit(requestId, outcome)
      await refresh()
      onDone?.()
    },
  })
}

/** 부분완료의 실패 작업 재시도. 서버가 실패 작업으로 새 Plan을 만들어 승인 대기로 둔다. 응답에 본인 승인 목록이 없어 자동으로 서명하지 않는다. */
export function useRetryFailed(request: RequestDetail) {
  const requestId = request.id
  const refresh = useRefreshAll()
  return useMutation({
    mutationFn: () => requestsApi.retryFailed(requestId),
    onSuccess: async () => {
      toast.success('실패 작업으로 새 Plan을 만들었습니다. 새 승인 서명이 필요합니다')
      await refresh()
    },
  })
}

/** 승인이 다 모였는데 웹쉘 연결 실패로 멈춘 요청의 실행을 다시 요청한다. 서명은 서버에 보관되어 있다. */
export function useStartExecution(requestId: string) {
  const refresh = useRefreshAll()
  return useMutation({
    mutationFn: () => requestsApi.startExecution(requestId),
    onSuccess: async ({ executionRequested }) => {
      // 웹쉘이 서명 검증을 거부하면 200으로 온다. 상세의 검증 실패 안내가 이유를 말한다.
      if (executionRequested) toast.success('실행을 다시 요청했습니다')
      else toast.error('웹쉘이 검증을 거부해 실행하지 못했습니다')
      await refresh()
    },
    onError: async () => {
      await refresh()
    },
  })
}

export function usePatchPlan(requestId: string) {
  const refresh = useRefreshAll()
  return useMutation({
    mutationFn: (body: { basePlanId?: string; changes?: PlanChange[]; answer?: string }) =>
      requestsApi.patchPlan(requestId, body),
    onSuccess: async () => {
      toast.info('AI가 Plan을 다시 분석합니다')
      await refresh()
    },
  })
}

export function useCancelRequest(requestId: string, onDone?: () => void) {
  const refresh = useRefreshAll()
  return useMutation({
    mutationFn: () => requestsApi.cancel(requestId),
    onSuccess: async () => {
      toast.success('요청을 취소했습니다')
      await refresh()
      onDone?.()
    },
  })
}

export function useRetryAnalysis(requestId: string) {
  const refresh = useRefreshAll()
  return useMutation({
    mutationFn: () => requestsApi.retryAnalysis(requestId),
    onSuccess: () => refresh(),
  })
}

export function useKillRequest(requestId: string, onDone?: () => void) {
  const refresh = useRefreshAll()
  return useMutation({
    mutationFn: (reason: string) => requestsApi.kill(requestId, reason),
    onSuccess: async (result) => {
      const skipped = result.skippedTaskIds.length ? ` 끝나지 않은 작업 ${result.skippedTaskIds.length}건은 더 실행하지 않습니다.` : ''
      toast.success(`실행을 중단했습니다.${skipped}`)
      await refresh()
      onDone?.()
    },
  })
}
