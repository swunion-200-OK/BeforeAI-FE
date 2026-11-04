import { useMutation, useQuery } from '@tanstack/react-query'
import { Building2, Plus } from 'lucide-react'
import { useState } from 'react'
import { adminApi } from '../../api/endpoints'
import type { Role, User } from '../../api/types'
import { toast } from '../../components/toast'
import { Banner, Button, ErrorState, Field, Modal, Mono, Select, Sheet, TextInput } from '../../components/ui'
import { ROLE_LABEL } from '../../lib/labels'
import { useDepartments, useRefreshAll } from '../../lib/queries'
import { usersQuery } from './adminQueries'

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

export interface IssuedPassword {
  name: string
  password: string
}

/** 초기 비밀번호는 발급 직후 이 창에서 한 번만 보여 준다. */
export function PasswordModal({ issued, onClose }: { issued: IssuedPassword | null; onClose: () => void }) {
  return (
    <Modal
      open={Boolean(issued)}
      title="초기 비밀번호 발급"
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          확인했습니다
        </Button>
      }
    >
      <p className="text-sm text-ink-2">{issued?.name}님에게 아래 초기 비밀번호를 전달해 주세요.</p>
      <p className="my-3 rounded-md border border-rule bg-sheet-alt px-3 py-2.5 text-center">
        <Mono className="text-base font-medium">{issued?.password ?? ''}</Mono>
      </p>
      <Banner tone="warning">이 창을 닫으면 다시 볼 수 없습니다. 첫 로그인 때 비밀번호를 바꾸게 됩니다.</Banner>
    </Modal>
  )
}

/** 표 옆에 늘 펴 둔 계정 생성 폼. 만들면 초기 비밀번호를 보여 주고 폼을 비운다. */
export function CreateUserPanel({ onIssued }: { onIssued: (issued: IssuedPassword) => void }) {
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
      setEmployeeNo('')
      setName('')
      setRole('EMPLOYEE')
      setDepartmentId(null)
      setSlackUserId('')
      await refresh()
    },
  })
  return (
    <Sheet title="계정 생성" icon={<Plus size={16} aria-hidden />}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (employeeNo.trim() && name.trim()) create.mutate()
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="사번">
            {(id) => <TextInput id={id} value={employeeNo} onChange={(event) => setEmployeeNo(event.target.value)} />}
          </Field>
          <Field label="이름">
            {(id) => <TextInput id={id} value={name} onChange={(event) => setName(event.target.value)} />}
          </Field>
          <Field label="역할">{(id) => <RoleSelect id={id} value={role} onChange={setRole} />}</Field>
          <Field label="부서">{(id) => <DepartmentSelect id={id} value={departmentId} onChange={setDepartmentId} />}</Field>
        </div>
        <Field label="Slack 사용자 ID" hint="비워 두면 나중에 지정할 수 있습니다">
          {(id) => <TextInput id={id} value={slackUserId} onChange={(event) => setSlackUserId(event.target.value)} />}
        </Field>
        <Button
          type="submit"
          variant="primary"
          disabled={!employeeNo.trim() || !name.trim()}
          disabledReason="사번과 이름을 입력해 주세요"
          loading={create.isPending}
          className="w-full"
        >
          계정 생성
        </Button>
        <p className="text-xs text-ink-3">회원가입은 없습니다. 만들면 초기 비밀번호가 발급됩니다.</p>
      </form>
    </Sheet>
  )
}

/** 표의 "변경" 버튼으로 연다. 고를 때마다 key를 바꿔 끼워 입력값을 그 사용자 것으로 맞춘다. */
export function EditUserModal({ user, onClose }: { user: User | null; onClose: () => void }) {
  const refresh = useRefreshAll()
  const [role, setRole] = useState<Role>(user?.role ?? 'EMPLOYEE')
  const [departmentId, setDepartmentId] = useState(user?.departmentId ?? null)
  const [slackUserId, setSlackUserId] = useState(user?.slackUserId ?? '')
  const update = useMutation({
    mutationFn: () =>
      adminApi.updateUser((user as User).id, { role, departmentId, slackUserId: slackUserId.trim() || null }),
    onSuccess: async () => {
      toast.success(`${user?.name} 계정을 변경했습니다`)
      await refresh()
      onClose()
    },
  })
  return (
    <Modal
      open={Boolean(user)}
      title={`${user?.name} 계정 변경`}
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

export function DepartmentsPanel() {
  const refresh = useRefreshAll()
  const departments = useDepartments()
  const users = useQuery(usersQuery)
  const [name, setName] = useState('')
  const create = useMutation({
    mutationFn: () => adminApi.createDepartment(name.trim()),
    onSuccess: async (department) => {
      toast.success(`${department.name}을 만들었습니다`)
      setName('')
      await refresh()
    },
  })
  const headcount = (departmentId: string) =>
    users.data?.filter((user) => user.departmentId === departmentId && user.active).length ?? 0
  return (
    <Sheet title="부서" icon={<Building2 size={16} aria-hidden />}>
      {departments.isError && <ErrorState error={departments.error} onRetry={() => departments.refetch()} />}
      <ul className="mb-3 divide-y divide-rule rounded-lg border border-rule text-[0.8125rem]">
        {departments.data?.map((department) => (
          <li key={department.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
            <span className="font-medium text-ink">{department.name}</span>
            <span className="text-xs text-ink-3 tabular-nums">{headcount(department.id)}명</span>
          </li>
        ))}
      </ul>
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (name.trim()) create.mutate()
        }}
      >
        <div className="min-w-0 flex-1">
          <Field label="새 부서 이름">
            {(id) => <TextInput id={id} value={name} onChange={(event) => setName(event.target.value)} />}
          </Field>
        </div>
        <Button type="submit" disabled={!name.trim()} disabledReason="부서 이름을 입력해 주세요" loading={create.isPending}>
          부서 생성
        </Button>
      </form>
    </Sheet>
  )
}
