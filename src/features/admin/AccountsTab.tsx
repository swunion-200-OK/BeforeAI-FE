import { useMutation, useQuery } from '@tanstack/react-query'
import { Ban, Check, Crown, KeyRound, Pencil, Power, UserCog, UserRound, UsersRound } from 'lucide-react'
import { useState } from 'react'
import { useMe } from '../../app/AuthProvider'
import { adminApi } from '../../api/endpoints'
import type { Role, User } from '../../api/types'
import { SegmentedTabs, StatCard, UserChip } from '../../components/rich'
import { toast } from '../../components/toast'
import { Button, ConfirmModal, EmptyState, ErrorState, Mono, Sheet, Spinner } from '../../components/ui'
import { ROLE_LABEL } from '../../lib/labels'
import { useDepartmentNames, useRefreshAll } from '../../lib/queries'
import { usersQuery } from './adminQueries'
import { CreateUserPanel, DepartmentsPanel, EditUserModal, PasswordModal, type IssuedPassword } from './AccountForms'

const ROLE_CLASS: Record<Role, string> = {
  ADMIN: 'bg-seal-soft text-seal-dark',
  DEPT_MANAGER: 'bg-internal-soft text-internal',
  EMPLOYEE: 'bg-forbidden-soft text-forbidden',
}

type RoleFilter = Role | 'ALL'

function UserStatus({ user }: { user: User }) {
  if (!user.active) {
    return <span className="rounded bg-forbidden-soft px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-forbidden">비활성</span>
  }
  if (user.mustChangePassword) {
    return <span className="rounded bg-medium-soft px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-medium">비밀번호 변경 전</span>
  }
  return <span className="rounded bg-low-soft px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-low">사용 중</span>
}

/** 넓은 화면에서는 아이콘과 글자를, 좁으면 아이콘만 보여 준다. 이름은 스크린 리더에 항상 남는다. */
function ActionLabel({ text }: { text: string }) {
  return <span className="max-2xl:sr-only">{text}</span>
}

function UsersTable({ users, onIssued }: { users: User[]; onIssued: (issued: IssuedPassword) => void }) {
  const me = useMe()
  const refresh = useRefreshAll()
  const departmentName = useDepartmentNames()
  const [filter, setFilter] = useState<RoleFilter>('ALL')
  const [editing, setEditing] = useState<User | null>(null)
  const [resetting, setResetting] = useState<User | null>(null)
  const [deactivating, setDeactivating] = useState<User | null>(null)

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
      onIssued({ name: user.name, password: result.initialPassword })
      await refresh()
    },
  })

  const shown = filter === 'ALL' ? users : users.filter((user) => user.role === filter)
  const count = (role: Role) => users.filter((user) => user.role === role).length

  return (
    <Sheet
      title="계정"
      icon={<UsersRound size={16} aria-hidden />}
      flush
      actions={
        <SegmentedTabs<RoleFilter>
          label="역할로 거르기"
          value={filter}
          onChange={setFilter}
          items={[
            { id: 'ALL', label: '전체', count: users.length },
            ...(Object.keys(ROLE_LABEL) as Role[]).map((role) => ({
              id: role,
              label: ROLE_LABEL[role],
              count: count(role),
            })),
          ]}
        />
      }
    >
      {shown.length === 0 ? (
        <EmptyState title="이 역할의 계정이 없습니다">오른쪽 폼에서 계정을 만들 수 있습니다.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="sheet-table">
            <thead>
              <tr>
                <th>사용자</th>
                <th>역할</th>
                <th>부서</th>
                <th>Slack ID</th>
                <th>상태</th>
                <th aria-label="동작" />
              </tr>
            </thead>
            <tbody>
              {shown.map((user) => (
                <tr key={user.id} className={user.active ? '' : 'bg-sheet-alt text-ink-3'}>
                  <td>
                    <UserChip name={user.name} sub={<span className="font-mono">{user.employeeNo}</span>} />
                  </td>
                  <td>
                    <span className={`rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${ROLE_CLASS[user.role]}`}>
                      {ROLE_LABEL[user.role]}
                    </span>
                  </td>
                  <td className="whitespace-nowrap">{departmentName(user.departmentId)}</td>
                  <td>{user.slackUserId ? <Mono>{user.slackUserId}</Mono> : <span className="text-ink-3">없음</span>}</td>
                  <td>
                    <UserStatus user={user} />
                  </td>
                  <td>
                    <div className="flex justify-end gap-1">
                      <Button size="sm" title="변경" onClick={() => setEditing(user)}>
                        <Pencil size={14} aria-hidden />
                        <ActionLabel text="변경" />
                      </Button>
                      <Button size="sm" title="비밀번호 초기화" onClick={() => setResetting(user)}>
                        <KeyRound size={14} aria-hidden />
                        <ActionLabel text="비밀번호 초기화" />
                      </Button>
                      {user.active ? (
                        <Button
                          size="sm"
                          variant="danger-outline"
                          title="비활성화"
                          disabled={user.id === me.id}
                          disabledReason="지금 로그인한 계정은 비활성화할 수 없습니다"
                          onClick={() => setDeactivating(user)}
                        >
                          <Ban size={14} aria-hidden />
                          <ActionLabel text="비활성화" />
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          title="활성화"
                          loading={setActive.isPending && setActive.variables?.user.id === user.id}
                          onClick={() => setActive.mutate({ user, active: true })}
                        >
                          <Power size={14} aria-hidden />
                          <ActionLabel text="활성화" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <EditUserModal key={editing?.id ?? 'closed'} user={editing} onClose={() => setEditing(null)} />
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
    </Sheet>
  )
}

export function AccountsTab() {
  const [issued, setIssued] = useState<IssuedPassword | null>(null)
  const users = useQuery(usersQuery)
  const list = users.data ?? []
  const active = list.filter((user) => user.active).length
  const count = (role: Role) => list.filter((user) => user.role === role).length
  const needsPasswordChange = list.filter((user) => user.active && user.mustChangePassword).length

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-5 gap-3">
        <StatCard label="전체 계정" value={list.length} icon={UsersRound} tone="seal" hint={`비활성 ${list.length - active}명`} />
        <StatCard
          label="사용 중"
          value={active}
          icon={Check}
          tone="green"
          hint={needsPasswordChange > 0 ? `비밀번호 변경 전 ${needsPasswordChange}명` : '모두 변경 완료'}
        />
        <StatCard label={ROLE_LABEL.ADMIN} value={count('ADMIN')} icon={Crown} tone="amber" />
        <StatCard label={ROLE_LABEL.DEPT_MANAGER} value={count('DEPT_MANAGER')} icon={UserCog} tone="live" />
        <StatCard label={ROLE_LABEL.EMPLOYEE} value={count('EMPLOYEE')} icon={UserRound} tone="neutral" />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          {users.isPending && (
            <Sheet title="계정">
              <Spinner />
            </Sheet>
          )}
          {users.isError && (
            <Sheet title="계정">
              <ErrorState error={users.error} onRetry={() => users.refetch()} />
            </Sheet>
          )}
          {users.data && <UsersTable users={users.data} onIssued={setIssued} />}
        </div>
        <div className="flex flex-col gap-4">
          <CreateUserPanel onIssued={setIssued} />
          <DepartmentsPanel />
        </div>
      </div>

      <PasswordModal issued={issued} onClose={() => setIssued(null)} />
    </div>
  )
}
