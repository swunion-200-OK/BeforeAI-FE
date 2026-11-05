import { queryOptions, useQuery } from '@tanstack/react-query'
import { adminApi, projectsApi } from '../../api/endpoints'
import type { Project } from '../../api/types'
import { useMe } from '../../app/AuthProvider'

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

/**
 * 서버의 기획서와 수정 요청에는 사람 ID만 있다. 아는 이름만 돌려주고 모르면 null이다.
 * 계정 목록은 관리자만 읽을 수 있다 (/admin/users).
 */
export function usePersonName(project: Project): (userId: string) => string | null {
  const me = useMe()
  const users = useQuery({ ...ownerCandidatesQuery, enabled: me.role === 'ADMIN' })
  return (userId) =>
    userId === me.id
      ? me.name
      : (project.owners.find((owner) => owner.id === userId)?.name ?? users.data?.find((user) => user.id === userId)?.name ?? null)
}
