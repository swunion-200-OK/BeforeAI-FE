import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError, errorMessage } from '../../api/errors'
import { projectsApi } from '../../api/endpoints'
import type { Project, User } from '../../api/types'
import { UserChip } from '../../components/rich'
import { toast } from '../../components/toast'
import { Banner, Button, ErrorState, Modal, Spinner } from '../../components/ui'
import { useDepartmentNames, useRefreshAll } from '../../lib/queries'
import { ownerCandidatesQuery } from './queries'

const MIN_OWNERS = 2

function OwnersEditor({ project, users, onClose }: { project: Project; users: User[]; onClose: () => void }) {
  const refreshAll = useRefreshAll()
  const departmentName = useDepartmentNames()
  const currentIds = project.owners.map((o) => o.id)
  const [selected, setSelected] = useState<string[]>(currentIds)
  const [serverError, setServerError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () => projectsApi.updateOwners(project.id, selected),
    meta: { silent: true },
    onSuccess: async () => {
      await refreshAll()
      onClose()
      toast.success('담당자를 저장했습니다')
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'OWNER_MINIMUM') setServerError(error.message)
      else toast.error(errorMessage(error))
    },
  })

  const inactiveIds = new Set(users.filter((user) => !user.active).map((user) => user.id))
  // 비활성 담당자는 승인할 수 없으므로 최소 인원에 세지 않는다.
  const activeSelected = selected.filter((id) => !inactiveIds.has(id))
  // 지금 담당자를 위로 올려 찾기 쉽게 한다. 고를 때 줄이 움직이지 않게 처음 담당자 기준으로만 정렬한다.
  const candidates = users
    .filter((user) => user.active || selected.includes(user.id) || currentIds.includes(user.id))
    .sort((a, b) => Number(currentIds.includes(b.id)) - Number(currentIds.includes(a.id)))

  const changed = selected.length !== currentIds.length || selected.some((id) => !currentIds.includes(id))
  const tooFew = activeSelected.length < MIN_OWNERS
  const inactiveChosen = selected.filter((id) => inactiveIds.has(id)).length
  const blockedReason = tooFew ? '담당자는 2명 이상이어야 합니다' : !changed ? '바뀐 내용이 없습니다' : null

  return (
    <Modal
      open
      title="담당자 관리"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button
            variant="primary"
            disabled={Boolean(blockedReason)}
            disabledReason={blockedReason}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            담당자 저장
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {tooFew ? (
          <Banner tone="danger">
            담당자는 2명 이상이어야 합니다. 지금 승인할 수 있는 담당자 {activeSelected.length}명을 골랐습니다.
          </Banner>
        ) : serverError ? (
          <Banner tone="danger">{serverError}</Banner>
        ) : (
          changed && (
            <Banner tone="warning" title="영향받는 승인 대기 요청은 재승인필요로 바뀝니다">
              관리자에게 알림이 가고, 새 담당자는 승인 키가 실행기에 등록되어야 승인할 수 있습니다.
            </Banner>
          )
        )}
        {inactiveChosen > 0 && (
          <p className="text-sm text-medium">
            비활성 계정 {inactiveChosen}명이 담당자로 남아 있습니다. 승인할 수 없고 인원에도 세지 않으니 체크를 풀어 주세요.
          </p>
        )}

        <fieldset>
          <legend className="sr-only">담당자 후보</legend>
          <ul className="quiet-scroll -mx-1 max-h-80 overflow-y-auto">
            {candidates.map((user) => (
              <li key={user.id}>
                <label className="flex items-center gap-2.5 rounded-md px-1 py-1.5 hover:bg-paper">
                  <input
                    type="checkbox"
                    checked={selected.includes(user.id)}
                    onChange={(event) => {
                      setServerError(null)
                      setSelected((current) =>
                        event.target.checked ? [...current, user.id] : current.filter((id) => id !== user.id),
                      )
                    }}
                    className="size-4 shrink-0 accent-seal"
                  />
                  <UserChip name={user.name} sub={departmentName(user.departmentId)} />
                  {!user.active && <span className="ml-auto shrink-0 text-xs font-medium text-forbidden">비활성 계정</span>}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      </div>
    </Modal>
  )
}

/** "담당자 관리" 버튼이 여는 창. 수정 권한이 있을 때만 쓴다. 띄울 때만 그린다. */
export function OwnersModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const users = useQuery(ownerCandidatesQuery)
  if (users.data) return <OwnersEditor project={project} users={users.data} onClose={onClose} />
  return (
    <Modal open title="담당자 관리" onClose={onClose}>
      {users.isError ? <ErrorState error={users.error} onRetry={() => users.refetch()} /> : <Spinner />}
    </Modal>
  )
}
