import { useMutation, useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useMe } from '../../app/AuthProvider'
import { adminApi } from '../../api/endpoints'
import type { Role, User } from '../../api/types'
import { toast } from '../../components/toast'
import {
  Banner,
  Button,
  ConfirmModal,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  Mono,
  Select,
  Sheet,
  Spinner,
  TextInput,
} from '../../components/ui'
import { ROLE_LABEL } from '../../lib/labels'
import { useDepartmentNames, useDepartments, useRefreshAll } from '../../lib/queries'

const ROLES = Object.keys(ROLE_LABEL) as Role[]

function RoleSelect({ id, value, onChange }: { id: string; value: Role; onChange: (role: Role) => void }) {
  return (
    <Select id={id} value={value} onChange={(event) => onChange(event.target.value as Role)}>
      {ROLES.map((role) => (
        <option key={role} value={role}>
          {ROLE_LABEL[role]}
        </option>
      ))}
    </Select>
  )
}

function DepartmentSelect({
  id,
  value,
  onChange,
}: {
  id: string
  value: string | null
  onChange: (departmentId: string | null) => void
}) {
  const { data } = useDepartments()
  return (
    <Select id={id} value={value ?? ''} onChange={(event) => onChange(event.target.value || null)}>
      <option value="">소속 없음</option>
      {data?.map((department) => (
        <option key={department.id} value={department.id}>
          {department.name}
        </option>
      ))}
    </Select>
  )
}

/** 초기 비밀번호는 발급 직후 이 창에서 한 번만 보여 준다. */
function PasswordModal({
  issued,
  onClose,
}: {
  issued: { name: string; password: string }
  onClose: () => void
}) {
  return (
    <Modal
      open
      title="초기 비밀번호 발급"
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          확인했습니다
        </Button>
      }
    >
      <p className="text-sm text-ink-2">{issued.name}님에게 아래 초기 비밀번호를 전달해 주세요.</p>
      <p className="my-3 rounded-md border border-rule bg-sheet-alt px-3 py-2.5 text-center">
        <Mono className="text-base font-medium">{issued.password}</Mono>
      </p>
      <Banner tone="warning">이 창을 닫으면 다시 볼 수 없습니다. 첫 로그인 때 비밀번호를 바꾸게 됩니다.</Banner>
    </Modal>
  )
}

function CreateUserModal({
  onClose,
  onIssued,
}: {
  onClose: () => void
  onIssued: (issued: { name: string; password: string }) => void
}) {
  const refresh = useRefreshAll()
  const [employeeNo, setEmployeeNo] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('EMPLOYEE')
  const [departmentId, setDepartmentId] = useState<string | null>(null)
  const [slackUserId, setSlackUserId] = useState('')
  const create = useMutation({
    mutationFn: () =>
      adminApi.createUser({
        employeeNo: employeeNo.trim(),
        name: name.trim(),
        role,
        departmentId,
        slackUserId: slackUserId.trim() || undefined,
      }),
    onSuccess: async (result) => {
      onIssued({ name: result.user.name, password: result.initialPassword })
      await refresh()
    },
  })
  return (
    <Modal
      open
      title="계정 생성"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>닫기</Button>
          <Button
            variant="primary"
            disabled={!employeeNo.trim() || !name.trim()}
            disabledReason="사번과 이름을 입력해 주세요"
            loading={create.isPending}
            onClick={() => create.mutate()}
          >
            계정 생성
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="사번">
          {(id) => <TextInput id={id} value={employeeNo} onChange={(event) => setEmployeeNo(event.target.value)} />}
        </Field>
        <Field label="이름">
          {(id) => <TextInput id={id} value={name} onChange={(event) => setName(event.target.value)} />}
        </Field>
        <Field label="역할">{(id) => <RoleSelect id={id} value={role} onChange={setRole} />}</Field>
        <Field label="부서">{(id) => <DepartmentSelect id={id} value={departmentId} onChange={setDepartmentId} />}</Field>
        <Field label="Slack 사용자 ID" hint="비워 두면 나중에 지정할 수 있습니다">
          {(id) => <TextInput id={id} value={slackUserId} onChange={(event) => setSlackUserId(event.target.value)} />}
        </Field>
      </div>
    </Modal>
  )
}

function EditUserModal({ user, onClose }: { user: User; onClose: () => void }) {
  const refresh = useRefreshAll()
  const [role, setRole] = useState(user.role)
  const [departmentId, setDepartmentId] = useState(user.departmentId)
  const [slackUserId, setSlackUserId] = useState(user.slackUserId ?? '')
  const update = useMutation({
    mutationFn: () => adminApi.updateUser(user.id, { role, departmentId, slackUserId: slackUserId.trim() || null }),
    onSuccess: async () => {
      toast.success(`${user.name} 계정을 변경했습니다`)
      await refresh()
      onClose()
    },
  })
  return (
    <Modal
      open
      title={`${user.name} 계정 변경`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>닫기</Button>
          <Button variant="primary" loading={update.isPending} onClick={() => update.mutate()}>
            변경 저장
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="역할">{(id) => <RoleSelect id={id} value={role} onChange={setRole} />}</Field>
        <Field label="부서">{(id) => <DepartmentSelect id={id} value={departmentId} onChange={setDepartmentId} />}</Field>
        <Field label="Slack 사용자 ID">
          {(id) => <TextInput id={id} value={slackUserId} onChange={(event) => setSlackUserId(event.target.value)} />}
        </Field>
      </div>
    </Modal>
  )
}

function UsersSection() {
  const me = useMe()
  const refresh = useRefreshAll()
  const departmentName = useDepartmentNames()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [resetting, setResetting] = useState<User | null>(null)
  const [deactivating, setDeactivating] = useState<User | null>(null)
  const [issued, setIssued] = useState<{ name: string; password: string } | null>(null)
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: async () => (await adminApi.users()).items })

  const setActive = useMutation({
    mutationFn: ({ user, active }: { user: User; active: boolean }) => adminApi.updateUser(user.id, { active }),
    onSuccess: async (user) => {
      toast.success(user.active ? `${user.name} 계정을 활성화했습니다` : `${user.name} 계정을 비활성화했습니다`)
      setDeactivating(null)
      await refresh()
    },
  })
  const resetPassword = useMutation({
    mutationFn: (user: User) => adminApi.resetPassword(user.id),
    onSuccess: async (result, user) => {
      setResetting(null)
      setIssued({ name: user.name, password: result.initialPassword })
      await refresh()
    },
  })

  return (
    <Sheet
      title="계정"
      flush
      actions={
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus size={15} aria-hidden />
          계정 생성
        </Button>
      }
    >
      {users.isPending && <Spinner />}
      {users.isError && <ErrorState error={users.error} onRetry={() => users.refetch()} />}
      {users.data?.length === 0 && <EmptyState title="계정이 없습니다">계정을 만들면 초기 비밀번호가 발급됩니다.</EmptyState>}
      {users.data && users.data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="sheet-table">
            <thead>
              <tr>
                <th>이름</th>
                <th>사번</th>
                <th>역할</th>
                <th>부서</th>
                <th>Slack ID</th>
                <th>상태</th>
                <th aria-label="동작" />
              </tr>
            </thead>
            <tbody>
              {users.data.map((user) => (
                <tr key={user.id} className={user.active ? '' : 'text-ink-3'}>
                  <td className="font-medium whitespace-nowrap">{user.name}</td>
                  <td>
                    <Mono>{user.employeeNo}</Mono>
                  </td>
                  <td className="whitespace-nowrap">{ROLE_LABEL[user.role]}</td>
                  <td className="whitespace-nowrap">{departmentName(user.departmentId)}</td>
                  <td>{user.slackUserId ? <Mono>{user.slackUserId}</Mono> : <span className="text-ink-3">없음</span>}</td>
                  <td className="whitespace-nowrap">
                    {!user.active ? (
                      <span className="rounded bg-forbidden-soft px-1.5 py-0.5 text-xs font-medium text-forbidden">비활성</span>
                    ) : user.mustChangePassword ? (
                      <span className="rounded bg-medium-soft px-1.5 py-0.5 text-xs font-medium text-medium">비밀번호 변경 전</span>
                    ) : (
                      <span className="rounded bg-low-soft px-1.5 py-0.5 text-xs font-medium text-low">사용 중</span>
                    )}
                  </td>
                  <td>
                    <div className="flex justify-end gap-1">
                      <Button size="sm" onClick={() => setEditing(user)}>
                        변경
                      </Button>
                      <Button size="sm" onClick={() => setResetting(user)}>
                        비밀번호 초기화
                      </Button>
                      {user.active ? (
                        <Button
                          size="sm"
                          variant="danger-outline"
                          disabled={user.id === me.id}
                          disabledReason="지금 로그인한 계정은 비활성화할 수 없습니다"
                          onClick={() => setDeactivating(user)}
                        >
                          비활성화
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          loading={setActive.isPending && setActive.variables?.user.id === user.id}
                          onClick={() => setActive.mutate({ user, active: true })}
                        >
                          활성화
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

      {creating && (
        <CreateUserModal
          onClose={() => setCreating(false)}
          onIssued={(value) => {
            setCreating(false)
            setIssued(value)
          }}
        />
      )}
      {editing && <EditUserModal key={editing.id} user={editing} onClose={() => setEditing(null)} />}
      {issued && <PasswordModal issued={issued} onClose={() => setIssued(null)} />}
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

function DepartmentsSection() {
  const refresh = useRefreshAll()
  const departments = useDepartments()
  const [name, setName] = useState('')
  const create = useMutation({
    mutationFn: () => adminApi.createDepartment(name.trim()),
    onSuccess: async (department) => {
      toast.success(`${department.name}을 만들었습니다`)
      setName('')
      await refresh()
    },
  })
  return (
    <Sheet title="부서">
      {departments.isError && <ErrorState error={departments.error} onRetry={() => departments.refetch()} />}
      <ul className="mb-4 flex flex-wrap gap-1.5">
        {departments.data?.map((department) => (
          <li key={department.id} className="rounded border border-rule px-2 py-1 text-[0.8125rem]">
            {department.name}
          </li>
        ))}
      </ul>
      <form
        className="flex max-w-md items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate()
        }}
      >
        <div className="flex-1">
          <Field label="새 부서 이름">
            {(id) => <TextInput id={id} value={name} onChange={(event) => setName(event.target.value)} />}
          </Field>
        </div>
        <Button
          type="submit"
          disabled={!name.trim()}
          disabledReason="부서 이름을 입력해 주세요"
          loading={create.isPending}
        >
          부서 생성
        </Button>
      </form>
    </Sheet>
  )
}

export function AccountsTab() {
  return (
    <div className="flex flex-col gap-4">
      <UsersSection />
      <DepartmentsSection />
    </div>
  )
}
