import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError, errorMessage } from '../../api/errors'
import { adminApi, projectsApi } from '../../api/endpoints'
import type { Project } from '../../api/types'
import { toast } from '../../components/toast'
import { Banner, Button, ConfirmModal, ErrorState, Sheet, Spinner } from '../../components/ui'
import { useDepartmentNames, useRefreshAll } from '../../lib/queries'

const MIN_OWNERS = 2

function OwnersEditor({ project }: { project: Project }) {
  const refreshAll = useRefreshAll()
  const departmentName = useDepartmentNames()
  const currentIds = project.owners.map((o) => o.id)
  const [selected, setSelected] = useState<string[]>(currentIds)
  const [confirming, setConfirming] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const users = useQuery({
    queryKey: ['users', 'owner-candidates'],
    queryFn: async () => (await adminApi.users()).items.filter((user) => user.active),
  })
  const save = useMutation({
    mutationFn: () => projectsApi.updateOwners(project.id, selected),
    meta: { silent: true },
    onSuccess: async () => {
      await refreshAll()
      toast.success('담당자를 저장했습니다')
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'OWNER_MINIMUM') setServerError(error.message)
      else toast.error(errorMessage(error))
    },
    onSettled: () => setConfirming(false),
  })

  if (users.isPending) return <Spinner />
  if (users.isError) return <ErrorState error={users.error} onRetry={() => users.refetch()} />

  const changed = selected.length !== currentIds.length || selected.some((id) => !currentIds.includes(id))
  const tooFew = selected.length < MIN_OWNERS
  const blockedReason = tooFew ? '담당자는 2명 이상이어야 합니다' : !changed ? '바뀐 내용이 없습니다' : null

  return (
    <Sheet
      title="담당자 지정"
      actions={
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
      }
    >
      <div className="mb-3 flex flex-col gap-2">
        {tooFew && <Banner tone="danger">담당자는 2명 이상이어야 합니다. 지금 {selected.length}명을 골랐습니다.</Banner>}
        {serverError && !tooFew && <Banner tone="danger">{serverError}</Banner>}
        {changed && !tooFew && (
          <Banner tone="warning" title="영향받는 승인 대기 요청은 재승인필요로 바뀝니다">
            새 담당자는 승인 키가 실행기에 등록되어야 승인할 수 있습니다.
          </Banner>
        )}
      </div>

      <fieldset>
        <legend className="sr-only">담당자 후보</legend>
        <ul className="grid gap-1 sm:grid-cols-2">
          {users.data.map((user) => (
            <li key={user.id}>
              <label className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-sheet-alt">
                <input
                  type="checkbox"
                  checked={selected.includes(user.id)}
                  onChange={(event) => {
                    setServerError(null)
                    setSelected((current) =>
                      event.target.checked ? [...current, user.id] : current.filter((id) => id !== user.id),
                    )
                  }}
                  className="size-4 accent-seal"
                />
                {user.name}
                <span className="text-xs text-ink-3">{departmentName(user.departmentId)}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

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
    </Sheet>
  )
}

export function OwnersTab({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const departmentName = useDepartmentNames()
  if (canEdit) {
    // 저장 뒤 서버 값으로 선택 상태를 다시 맞춘다.
    return <OwnersEditor key={project.owners.map((o) => o.id).join(',')} project={project} />
  }
  return (
    <Sheet title="담당자">
      <p className="mb-3 text-sm text-ink-2">담당자는 모두 같은 권한으로 DB 접근·데이터 수정·배포 작업을 승인합니다.</p>
      <ul className="flex flex-col gap-1 text-sm">
        {project.owners.map((owner) => (
          <li key={owner.id}>
            {owner.name} <span className="text-xs text-ink-3">{departmentName(owner.departmentId)}</span>
          </li>
        ))}
      </ul>
    </Sheet>
  )
}
