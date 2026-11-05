import { useMutation, useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useMe } from '../../app/AuthProvider'
import { adminApi } from '../../api/endpoints'
import { ApiError, errorMessage } from '../../api/errors'
import type { Role, User } from '../../api/types'
import { toast } from '../../components/toast'
import { Banner, Button, ErrorState, Field, Modal, Mono, Select, TextInput } from '../../components/ui'
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
  allowNone = true,
}: {
  id: string
  value: string | null
  onChange: (departmentId: string | null) => void
  allowNone?: boolean
}) {
  const { data } = useDepartments()
  return (
    <Select id={id} value={value ?? ''} onChange={(event) => onChange(event.target.value || null)}>
      {allowNone && <option value="">소속 없음</option>}
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

/** 만들면 창을 닫고 초기 비밀번호를 보여 준다. 사번이 겹치면 입력값을 둔 채 오류만 알린다. */
export function CreateUserModal({
  onClose,
  onIssued,
}: {
  onClose: () => void
  onIssued: (issued: IssuedPassword) => void
}) {
  const refresh = useRefreshAll()
  const formId = useId()
  const [employeeNumber, setEmployeeNumber] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('EMPLOYEE')
  const [departmentId, setDepartmentId] = useState<string | null>(null)
  const create = useMutation({
    meta: { silent: true },
    mutationFn: () =>
      adminApi.createUser({
        employeeNumber: employeeNumber.trim(),
        name: name.trim(),
        role,
        departmentId,
      }),
    onSuccess: async (result) => {
      onIssued({ name: result.user.name, password: result.initialPassword })
      onClose()
      await refresh()
    },
    // 서버는 사번이 겹치면 INVALID_STATE로 답한다. 표의 일반 문구로는 무엇을 고칠지 모른다.
    onError: (reason) =>
      toast.error(reason instanceof ApiError && reason.code === 'INVALID_STATE' ? '이미 쓰고 있는 사번입니다' : errorMessage(reason)),
  })
  return (
    <Modal
      open
      title="계정 추가"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>닫기</Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            disabled={!employeeNumber.trim() || !name.trim()}
            disabledReason="사번과 이름을 입력해 주세요"
            loading={create.isPending}
          >
            계정 생성
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="grid grid-cols-2 gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (employeeNumber.trim() && name.trim()) create.mutate()
        }}
      >
        <Field label="사번">
          {(id) => <TextInput id={id} value={employeeNumber} onChange={(event) => setEmployeeNumber(event.target.value)} />}
        </Field>
        <Field label="이름">
          {(id) => <TextInput id={id} value={name} onChange={(event) => setName(event.target.value)} />}
        </Field>
        <Field label="역할">{(id) => <RoleSelect id={id} value={role} onChange={setRole} />}</Field>
        <Field label="부서">{(id) => <DepartmentSelect id={id} value={departmentId} onChange={setDepartmentId} />}</Field>
      </form>
    </Modal>
  )
}

/** 표의 "관리" 버튼으로 연다. 역할·부서 변경과 비밀번호 초기화, 비활성화를 여기서 한다. */
export function ManageUserModal({
  user,
  onClose,
  onResetPassword,
  onDeactivate,
  onActivate,
}: {
  user: User
  onClose: () => void
  onResetPassword: () => void
  onDeactivate: () => void
  onActivate: () => void
}) {
  const me = useMe()
  const refresh = useRefreshAll()
  const [role, setRole] = useState<Role>(user.role)
  const [departmentId, setDepartmentId] = useState(user.departmentId)
  const update = useMutation({
    mutationFn: () => adminApi.updateUser(user.id, { role, departmentId }),
    onSuccess: async () => {
      toast.success(`${user.name} 계정을 변경했습니다`)
      await refresh()
      onClose()
    },
  })
  return (
    <Modal
      open
      title={`${user.name} 계정 관리`}
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
        {/* 서버는 부서 null을 "바꾸지 않음"으로 읽는다. 소속이 있는 계정에 "소속 없음"을 내놓으면 저장해도 그대로다. */}
        <Field label="부서">
          {(id) => <DepartmentSelect id={id} value={departmentId} onChange={setDepartmentId} allowNone={user.departmentId === null} />}
        </Field>
        <div className="mt-2 flex gap-2 border-t border-rule pt-4">
          <Button onClick={onResetPassword}>비밀번호 초기화</Button>
          {user.active ? (
            <Button
              variant="danger-outline"
              disabled={user.id === me.id}
              disabledReason="지금 로그인한 계정은 비활성화할 수 없습니다"
              onClick={onDeactivate}
            >
              비활성화
            </Button>
          ) : (
            <Button onClick={onActivate}>활성화</Button>
          )}
        </div>
      </div>
    </Modal>
  )
}

export function DepartmentsModal({ onClose }: { onClose: () => void }) {
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
    <Modal open title="부서 관리" onClose={onClose}>
      {departments.isError && <ErrorState error={departments.error} onRetry={() => departments.refetch()} />}
      <ul className="mb-4 divide-y divide-rule text-sm">
        {departments.data?.map((department) => (
          <li key={department.id} className="flex items-center justify-between gap-2 py-2">
            <span className="font-medium text-ink">{department.name}</span>
            <span className="text-ink-3 tabular-nums">{headcount(department.id)}명</span>
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
        <Button
          type="submit"
          variant="primary"
          disabled={!name.trim()}
          disabledReason="부서 이름을 입력해 주세요"
          loading={create.isPending}
        >
          부서 생성
        </Button>
      </form>
    </Modal>
  )
}
