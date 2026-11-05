import { useMutation, useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { adminApi } from '../../api/endpoints'
import type { Role, User } from '../../api/types'
import { toast } from '../../components/toast'
import { Button, ConfirmModal, EmptyState, ErrorState, Select, Sheet, Spinner } from '../../components/ui'
import { ROLE_LABEL } from '../../lib/labels'
import { useDepartmentNames, useRefreshAll } from '../../lib/queries'
import { usersQuery } from './adminQueries'
import { CreateUserModal, DepartmentsModal, ManageUserModal, PasswordModal, type IssuedPassword } from './AccountForms'

type RoleFilter = Role | 'ALL'

function UserStatus({ user }: { user: User }) {
  if (!user.active) return <span className="text-ink-3">비활성</span>
  return <span className="text-ink-2">사용 중</span>
}

function UsersTable({ users, onManage }: { users: User[]; onManage: (user: User) => void }) {
  const departmentName = useDepartmentNames()
  return (
    <div className="overflow-x-auto">
      <table className="sheet-table [&_td]:py-3">
        <thead>
          <tr>
            <th>사용자</th>
            <th>역할</th>
            <th>부서</th>
            <th>상태</th>
            <th aria-label="관리" />
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className={user.active ? '' : 'text-ink-3'}>
              <td className="whitespace-nowrap">
                <span className="font-medium">{user.name}</span>
                <span className="ml-2 font-mono text-xs text-ink-3">{user.employeeNumber}</span>
              </td>
              <td className="whitespace-nowrap">{ROLE_LABEL[user.role]}</td>
              <td className="whitespace-nowrap">{departmentName(user.departmentId)}</td>
              <td>
                <UserStatus user={user} />
              </td>
              <td className="text-right">
                <Button size="sm" onClick={() => onManage(user)}>
                  관리
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function AccountsTab() {
  const refresh = useRefreshAll()
  const users = useQuery(usersQuery)
  const [filter, setFilter] = useState<RoleFilter>('ALL')
  const [opened, setOpened] = useState<'create' | 'departments' | null>(null)
  const [managing, setManaging] = useState<User | null>(null)
  const [resetting, setResetting] = useState<User | null>(null)
  const [deactivating, setDeactivating] = useState<User | null>(null)
  const [issued, setIssued] = useState<IssuedPassword | null>(null)

  const setActive = useMutation({
    mutationFn: ({ user, active }: { user: User; active: boolean }) => adminApi.updateUser(user.id, { active }),
    onSuccess: async (user) => {
      toast.success(user.active ? `${user.name} 계정을 활성화했습니다` : `${user.name} 계정을 비활성화했습니다`)
      setDeactivating(null)
      await refresh()
    },
    // 담당자를 비활성화할 수 없을 때 같은 오류로 창이 닫히지 않으면 원인을 읽기 어렵다.
    onError: () => setDeactivating(null),
  })
  const resetPassword = useMutation({
    mutationFn: (user: User) => adminApi.resetPassword(user.id),
    onSuccess: async (result, user) => {
      setResetting(null)
      setIssued({ name: user.name, password: result.initialPassword })
      await refresh()
    },
  })

  const shown = users.data?.filter((user) => filter === 'ALL' || user.role === filter)

  return (
    <>
      <Sheet
        title={shown ? `계정 ${shown.length}명` : '계정'}
        flush
        actions={
          <>
            <div className="w-36">
              <Select
                aria-label="역할로 거르기"
                value={filter}
                onChange={(event) => setFilter(event.target.value as RoleFilter)}
              >
                <option value="ALL">전체 역할</option>
                {(Object.keys(ROLE_LABEL) as Role[]).map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABEL[role]}
                  </option>
                ))}
              </Select>
            </div>
            <Button onClick={() => setOpened('departments')}>부서 관리</Button>
            <Button variant="primary" onClick={() => setOpened('create')}>
              <Plus size={15} aria-hidden />
              계정 추가
            </Button>
          </>
        }
      >
        {users.isPending && <Spinner />}
        {users.isError && <ErrorState error={users.error} onRetry={() => users.refetch()} />}
        {shown?.length === 0 && <EmptyState title="이 역할의 계정이 없습니다" />}
        {shown && shown.length > 0 && <UsersTable users={shown} onManage={setManaging} />}
      </Sheet>

      {opened === 'create' && <CreateUserModal onClose={() => setOpened(null)} onIssued={setIssued} />}
      {opened === 'departments' && <DepartmentsModal onClose={() => setOpened(null)} />}
      {managing && (
        <ManageUserModal
          key={managing.id}
          user={managing}
          onClose={() => setManaging(null)}
          onResetPassword={() => {
            setManaging(null)
            setResetting(managing)
          }}
          onDeactivate={() => {
            setManaging(null)
            setDeactivating(managing)
          }}
          onActivate={() => {
            setManaging(null)
            setActive.mutate({ user: managing, active: true })
          }}
        />
      )}
      <ConfirmModal
        open={Boolean(resetting)}
        title="비밀번호 초기화"
        confirmLabel="비밀번호 초기화"
        danger
        loading={resetPassword.isPending}
        onClose={() => setResetting(null)}
        onConfirm={() => resetting && resetPassword.mutate(resetting)}
      >
        {resetting?.name}님의 비밀번호를 초기 비밀번호로 바꿉니다. 다음 로그인 때 새 비밀번호를 정해야 합니다.
      </ConfirmModal>
      <ConfirmModal
        open={Boolean(deactivating)}
        title="계정 비활성화"
        confirmLabel="비활성화"
        danger
        loading={setActive.isPending}
        onClose={() => setDeactivating(null)}
        onConfirm={() => deactivating && setActive.mutate({ user: deactivating, active: false })}
      >
        {deactivating?.name}님은 더 이상 로그인하거나 승인할 수 없습니다.
      </ConfirmModal>
      <PasswordModal issued={issued} onClose={() => setIssued(null)} />
    </>
  )
}
