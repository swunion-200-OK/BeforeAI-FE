import { queryOptions } from '@tanstack/react-query'
import { adminApi, projectsApi } from '../../api/endpoints'

/** 기획서 현재 버전. 목록, 머리글, 본문이 같은 값을 쓴다. */
export const specQuery = (projectId: string) =>
  queryOptions({ queryKey: ['project-spec', projectId], queryFn: () => projectsApi.spec(projectId) })

/** 수정 요청 전체. 상태별로 나누는 건 화면에서 한다. */
export const changeRequestsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['project-change-requests', projectId],
    queryFn: async () => (await projectsApi.changeRequests(projectId)).items,
  })

/** 담당자 후보. 비활성 계정도 받아야 이미 담당자로 지정된 비활성 계정을 알아보고 해제할 수 있다. */
export const ownerCandidatesQuery = queryOptions({
  queryKey: ['users', 'owner-candidates'],
  queryFn: async () => (await adminApi.users()).items,
})
