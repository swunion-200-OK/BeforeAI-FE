import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { requestsApi } from '../../api/endpoints'
import type { RequestStatus } from '../../api/types'
import { interruptedTaskIds } from '../../lib/settledTask'

const NONE: ReadonlySet<string> = new Set()

/** 킬 스위치로 끝난 요청에서 실행 중 멈춘 작업. 작업 상태로는 시작 전 작업과 구별되지 않아 진행 트리의 실행 단계로 안다. */
export function useInterruptedTasks(requestId: string, status: RequestStatus | undefined): ReadonlySet<string> {
  const tree = useQuery({
    queryKey: ['progress', requestId],
    queryFn: () => requestsApi.progress(requestId),
    enabled: status === 'KILLED',
  })
  return useMemo(() => (status === 'KILLED' && tree.data ? interruptedTaskIds(tree.data.root) : NONE), [status, tree.data])
}
