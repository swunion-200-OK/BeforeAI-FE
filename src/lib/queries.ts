import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { networkStore } from '../api/client'
import { approvalsApi, orgApi, projectsApi, requestsApi } from '../api/endpoints'
import type { Network, RequestStatus } from '../api/types'

/** 응답 헤더 X-Network로 받은 현재 접속 환경 */
export function useNetwork(): Network {
  return useSyncExternalStore(networkStore.subscribe, networkStore.get) ?? 'INTERNAL'
}

export function useIsExternal(): boolean {
  return useNetwork() === 'EXTERNAL'
}

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: async () => (await projectsApi.list()).items,
    staleTime: 30_000,
  })
}

export function useDepartments() {
  return useQuery({
    queryKey: ['departments'],
    queryFn: async () => (await orgApi.departments()).items,
    staleTime: 60_000,
  })
}

export function useDepartmentNames(): (id: string | null | undefined) => string {
  const { data } = useDepartments()
  const names = useMemo(() => new Map(data?.map((d) => [d.id, d.name])), [data])
  return useCallback((id) => (id ? (names.get(id) ?? id) : '소속 없음'), [names])
}

const LIVE_STATUSES: RequestStatus[] = ['ANALYZING', 'RUNNING', 'ROLLING_BACK']

/** 분석·실행 중에는 1초마다 다시 읽어 상태 변화를 따라간다. */
export function useRequest(requestId: string | undefined) {
  return useQuery({
    queryKey: ['request', requestId],
    queryFn: () => requestsApi.get(requestId as string),
    enabled: Boolean(requestId),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status && LIVE_STATUSES.includes(status) ? 1000 : false
    },
  })
}

export function usePendingApprovals() {
  return useQuery({
    queryKey: ['approvals', 'pending'],
    queryFn: async () => (await approvalsApi.pending()).items,
  })
}

/** 상태를 바꾼 뒤 화면의 데이터를 전부 새로 읽는다. 목록과 상세가 어긋나지 않게 하는 가장 단순한 방법이다. */
export function useRefreshAll() {
  const client = useQueryClient()
  return useCallback(() => client.invalidateQueries(), [client])
}
