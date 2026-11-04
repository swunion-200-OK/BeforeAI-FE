import { useMutation, useQuery } from '@tanstack/react-query'
import { Users } from 'lucide-react'
import { useState } from 'react'
import { ApiError, errorMessage } from '../../api/errors'
import { adminApi, projectsApi } from '../../api/endpoints'
import type { Project, User } from '../../api/types'
import { UserChip } from '../../components/rich'
import { toast } from '../../components/toast'
import { Banner, Button, ConfirmModal, ErrorState, Sheet, Spinner } from '../../components/ui'
import { useDepartmentNames, useRefreshAll } from '../../lib/queries'

const MIN_OWNERS = 2

function useOwnerCandidates(enabled: boolean) {
  return useQuery({
    queryKey: ['users', 'owner-candidates'],
    // 비활성 계정도 받아야 이미 담당자로 지정된 비활성 계정을 알아보고 해제할 수 있다.
    queryFn: async () => (await adminApi.users()).items,
    enabled,
  })
}

function OwnersEditor({ project, users, onDone }: { project: Project; users: User[]; onDone: () => void }) {
  const refreshAll = useRefreshAll()
  const departmentName = useDepartmentNames()
  const currentIds = project.owners.map((o) => o.id)
  const [selected, setSelected] = useState<string[]>(currentIds)
  const [confirming, setConfirming] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () => projectsApi.updateOwners(project.id, selected),
    meta: { silent: true },
    onSuccess: async () => {
      // 편집기가 사라지기 전에 확인 창을 먼저 닫는다. 그래야 토스트가 닫힌 창 안에 갇히지 않는다.
      setConfirming(false)
      await refreshAll()
      toast.success('담당자를 저장했습니다')
      onDone()
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'OWNER_MINIMUM') setServerError(error.message)
      else toast.error(errorMessage(error))
    },
    onSettled: () => setConfirming(false),
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
    <div className="flex flex-col gap-3">
      {tooFew && (
        <Banner tone="danger">
          담당자는 2명 이상이어야 합니다. 지금 승인할 수 있는 담당자 {activeSelected.length}명을 골랐습니다.
        </Banner>
      )}
      {inactiveChosen > 0 && (
        <Banner tone="warning" title={`비활성 계정 ${inactiveChosen}명이 담당자로 남아 있습니다`}>
          비활성 계정은 승인할 수 없고 담당자 인원에도 세지 않습니다. 체크를 풀어 해제해 주세요.
        </Banner>
      )}
      {serverError && !tooFew && <Banner tone="danger">{serverError}</Banner>}
      {changed && !tooFew && (
        <Banner tone="warning" title="영향받는 승인 대기 요청은 재승인필요로 바뀝니다">
          새 담당자는 승인 키가 실행기에 등록되어야 승인할 수 있습니다.
        </Banner>
      )}

      <fieldset>
        <legend className="sr-only">담당자 후보</legend>
        <ul className="quiet-scroll -mx-1 max-h-72 overflow-y-auto">
          {candidates.map((user) => (
            <li key={user.id}>
              <label className="flex items-center gap-2.5 rounded-md px-1 py-1 hover:bg-paper">
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
                {!user.active && (
                  <span className="ml-auto shrink-0 rounded bg-forbidden-soft px-1.5 text-xs font-medium text-forbidden">
                    비활성 계정
                  </span>
                )}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      <div className="flex justify-end gap-2">
        <Button size="sm" onClick={onDone}>
          취소
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={Boolean(blockedReason)}
          disabledReason={blockedReason}
          loading={save.isPending}
          onClick={() => setConfirming(true)}
        >
          담당자 저장
        </Button>
      </div>

      <ConfirmModal
        open={confirming}
        title="담당자를 바꿀까요?"
        confirmLabel="담당자 저장"
        loading={save.isPending}
        onConfirm={() => save.mutate()}
        onClose={() => setConfirming(false)}
      >
        빠지는 담당자의 서명이 필요한 승인 대기 요청은 재승인필요로 바뀌고, 관리자에게 알림이 갑니다.
      </ConfirmModal>
    </div>
  )
}

/** 오른쪽 담당자 패널. 수정 권한이 있으면 여기에서 바로 관리한다. */
export function OwnersPanel({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const departmentName = useDepartmentNames()
  const [editing, setEditing] = useState(false)
  const users = useOwnerCandidates(canEdit)
  const inactiveIds = new Set(users.data?.filter((user) => !user.active).map((user) => user.id))

  return (
    <Sheet
      title={`담당자 ${project.owners.length}명`}
      icon={<Users size={16} aria-hidden />}
      actions={
        canEdit && !editing ? (
          <Button size="sm" onClick={() => setEditing(true)}>
            담당자 관리
          </Button>
        ) : undefined
      }
    >
      {editing ? (
        users.isPending ? (
          <Spinner />
        ) : users.isError ? (
          <ErrorState error={users.error} onRetry={() => users.refetch()} />
        ) : (
          <OwnersEditor project={project} users={users.data} onDone={() => setEditing(false)} />
        )
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {project.owners.map((owner) => (
              <li key={owner.id} className="flex items-center justify-between gap-2">
                <UserChip name={owner.name} sub={departmentName(owner.departmentId)} size="md" />
                {inactiveIds.has(owner.id) && (
                  <span className="shrink-0 rounded bg-forbidden-soft px-1.5 text-xs font-medium text-forbidden">
                    비활성 계정
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-3">
            담당자는 모두 같은 권한으로 DB 접근·데이터 수정·배포 작업을 승인합니다.
          </p>
        </>
      )}
    </Sheet>
  )
}
