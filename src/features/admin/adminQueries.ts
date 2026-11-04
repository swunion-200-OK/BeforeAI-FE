import { queryOptions } from '@tanstack/react-query'
import { adminApi, forbiddenApi, requestsApi } from '../../api/endpoints'
import type { ForbiddenProposalStatus } from '../../api/types'

/** 설정의 왼쪽 탭 건수와 각 탭 내용이 같은 데이터를 보도록 쿼리를 한곳에 둔다. */

export const usersQuery = queryOptions({
  queryKey: ['admin', 'users'],
  queryFn: async () => (await adminApi.users()).items,
})

export const signingKeysQuery = queryOptions({
  queryKey: ['admin', 'signing-keys'],
  queryFn: async () => (await adminApi.signingKeys()).items,
})

export const policyQuery = queryOptions({
  queryKey: ['admin', 'policy'],
  queryFn: adminApi.policy,
})

export const runningRequestsQuery = queryOptions({
  queryKey: ['requests', 'running-all'],
  queryFn: async () => (await requestsApi.list({ status: 'RUNNING', limit: 100 })).items,
})

export const proposalsQuery = (status: ForbiddenProposalStatus) =>
  queryOptions({
    queryKey: ['admin', 'forbidden-proposals', status],
    queryFn: async () => (await forbiddenApi.proposals(status)).items,
  })
