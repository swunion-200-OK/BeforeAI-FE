import { useMutation } from '@tanstack/react-query'
import { useMe } from '../../app/AuthProvider'
import { requestsApi } from '../../api/endpoints'
import type { PlanChange, SubmitResponse } from '../../api/types'
import { toast } from '../../components/toast'
import { useRefreshAll } from '../../lib/queries'
import { submitWithSelfApproval, type SubmitOutcome } from '../approvals/approvalFlow'

/** 제출 결과를 문구로 알린다. 제출(1차 확인)과 승인(2차)을 섞어 쓰지 않는다. */
function announceSubmit(outcome: SubmitOutcome) {
  if (outcome.selfApprovedTaskIds.length > 0) {
    const approved = `제출과 함께 본인 승인됨: ${outcome.selfApprovedTaskIds.join(', ')}`
    toast.success(outcome.executionRequested ? `${approved}. 필요한 승인이 모두 모여 실행을 요청했습니다` : approved)
  } else {
    toast.success('제출했습니다. 승인권자의 승인을 기다립니다')
  }
  if (outcome.selfApprovalError) {
    toast.error(`제출은 됐지만 본인 승인은 하지 못했습니다: ${outcome.selfApprovalError}`)
  }
}

/** 제출·다시 제출. 본인 승인이 허용된 작업은 제출과 함께 승인까지 끝낸다. */
export function useSubmitRequest(requestId: string, onDone?: () => void) {
  const me = useMe()
  const refresh = useRefreshAll()
  return useMutation({
    mutationFn: () => submitWithSelfApproval(me, requestId),
    onSuccess: async (outcome) => {
      announceSubmit(outcome)
      await refresh()
      onDone?.()
    },
  })
}

/** 부분완료의 실패 작업 재시도. 서명은 1회용이라 새 해시에 새 서명을 받는다. */
export function useRetryFailed(requestId: string) {
  const me = useMe()
  const refresh = useRefreshAll()
  return useMutation({
    mutationFn: async () => {
      const submitted: SubmitResponse = await requestsApi.retryFailed(requestId)
      return submitWithSelfApproval(me, requestId, submitted)
    },
    onSuccess: async (outcome) => {
      announceSubmit(outcome)
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
      const skipped = result.skippedTaskIds.length ? ` 실행 안 한 작업: ${result.skippedTaskIds.join(', ')}` : ''
      toast.success(`실행을 중단했습니다.${skipped}`)
      await refresh()
      onDone?.()
    },
  })
}
