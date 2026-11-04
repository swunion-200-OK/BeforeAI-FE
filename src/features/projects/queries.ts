import { queryOptions } from '@tanstack/react-query'
import { projectsApi } from '../../api/endpoints'

/** 기획서 현재 버전. 목록 카드, 오른쪽 패널, 본문이 같은 값을 쓴다. */
export const specQuery = (projectId: string) =>
  queryOptions({ queryKey: ['project-spec', projectId], queryFn: () => projectsApi.spec(projectId) })

/** 수정 요청 전체. 상태별로 나누는 건 화면에서 한다. */
export const changeRequestsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['project-change-requests', projectId],
    queryFn: async () => (await projectsApi.changeRequests(projectId)).items,
  })
