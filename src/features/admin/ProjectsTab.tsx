import { useMutation, useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useId, useState } from 'react'
import { Link } from 'react-router'
import { adminApi } from '../../api/endpoints'
import { toast } from '../../components/toast'
import { EmptyState, Button, ErrorState, Field, Modal, Mono, Select, Sheet, Spinner, TextArea, TextInput } from '../../components/ui'
import { useDepartmentNames, useDepartments, useProjects, useRefreshAll } from '../../lib/queries'
import { usersQuery } from './adminQueries'

const MIN_OWNERS = 2

function CreateProjectModal({ onClose }: { onClose: () => void }) {
  const refresh = useRefreshAll()
  const formId = useId()
  const departments = useDepartments()
  const departmentName = useDepartmentNames()
  const users = useQuery(usersQuery)
  const [name, setName] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [repository, setRepository] = useState('')
  const [ownerIds, setOwnerIds] = useState<string[]>([])
  const [specBody, setSpecBody] = useState('')
  const selectedDepartment = departmentId || departments.data?.[0]?.id || ''

  const create = useMutation({
    mutationFn: () =>
      adminApi.createProject({
        name: name.trim(),
        departmentId: selectedDepartment,
        repository: repository.trim(),
        ownerIds,
        specBody,
      }),
    onSuccess: async (project) => {
      toast.success(`${project.name} 프로젝트를 만들었습니다`)
      onClose()
      await refresh()
    },
  })

  const lackingOwners = ownerIds.length < MIN_OWNERS
  const blockedReason = !name.trim()
    ? '프로젝트 이름을 입력해 주세요'
    : !repository.trim()
      ? '저장소를 입력해 주세요'
      : lackingOwners
        ? '담당자는 2명 이상이어야 합니다'
        : !specBody.trim()
          ? '초기 기획서를 입력해 주세요'
          : null

  const toggleOwner = (userId: string, checked: boolean) => {
    setOwnerIds((current) => (checked ? [...current, userId] : current.filter((id) => id !== userId)))
  }

  return (
    <Modal
      open
      wide
      title="프로젝트 만들기"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>닫기</Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            disabled={Boolean(blockedReason)}
            disabledReason={blockedReason}
            loading={create.isPending}
          >
            프로젝트 만들기
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="grid grid-cols-2 gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (!blockedReason) create.mutate()
        }}
      >
        <Field label="프로젝트 이름">
          {(id) => <TextInput id={id} value={name} onChange={(event) => setName(event.target.value)} />}
        </Field>
        <Field label="담당 부서">
          {(id) => (
            <Select id={id} value={selectedDepartment} onChange={(event) => setDepartmentId(event.target.value)}>
              {departments.data?.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="col-span-2">
          <Field label="저장소">
            {(id) => (
              <TextInput
                id={id}
                className="font-mono"
                placeholder="git@internal:auth-service.git"
                value={repository}
                onChange={(event) => setRepository(event.target.value)}
              />
            )}
          </Field>
        </div>
        <fieldset className="col-span-2">
          <legend className="mb-1 text-[0.875rem] font-medium text-ink-2">담당자 (2명 이상)</legend>
          {users.isPending && <Spinner />}
          {users.isError && <ErrorState error={users.error} onRetry={() => users.refetch()} />}
          <div className="grid grid-cols-3 gap-1">
            {users.data
              ?.filter((user) => user.active)
              .map((user) => {
                const checked = ownerIds.includes(user.id)
                return (
                  <label
                    key={user.id}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-sm ${
                      checked ? 'border-seal bg-seal-soft/40' : 'border-rule hover:bg-sheet-alt'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="accent-seal"
                      checked={checked}
                      onChange={(event) => toggleOwner(user.id, event.target.checked)}
                    />
                    <span className="min-w-0 truncate">
                      {user.name}
                      <span className="ml-1.5 text-xs text-ink-3">{departmentName(user.departmentId)}</span>
                    </span>
                  </label>
                )
              })}
          </div>
          <p className="mt-1.5 text-[0.875rem] text-ink-3">{ownerIds.length}명 선택함</p>
        </fieldset>
        <div className="col-span-2">
          <Field label="초기 기획서" hint="AI가 이 프로젝트를 분석할 때 컨텍스트로 씁니다">
            {(id) => <TextArea id={id} rows={5} value={specBody} onChange={(event) => setSpecBody(event.target.value)} />}
          </Field>
        </div>
      </form>
    </Modal>
  )
}

export function ProjectsTab() {
  const projects = useProjects()
  const departmentName = useDepartmentNames()
  const [creating, setCreating] = useState(false)
  const count = projects.data?.length
  return (
    <>
      <Sheet
        title={count === undefined ? '프로젝트' : `프로젝트 ${count}개`}
        flush
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={15} aria-hidden />
            프로젝트 만들기
          </Button>
        }
      >
        {projects.isPending && <Spinner />}
        {projects.isError && <ErrorState error={projects.error} onRetry={() => projects.refetch()} />}
        {projects.data?.length === 0 && <EmptyState title="등록된 프로젝트가 없습니다" />}
        {projects.data && projects.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="sheet-table [&_td]:py-3">
              <thead>
                <tr>
                  <th>프로젝트</th>
                  <th>담당 부서</th>
                  <th>담당자</th>
                </tr>
              </thead>
              <tbody>
                {projects.data.map((project) => (
                  <tr key={project.id}>
                    <td>
                      <Link to={`/projects/${project.id}`} className="font-medium text-ink hover:text-seal hover:underline">
                        {project.name}
                      </Link>
                      <div className="mt-0.5">
                        <Mono className="text-ink-3">{project.repository}</Mono>
                      </div>
                    </td>
                    <td className="whitespace-nowrap">{departmentName(project.departmentId)}</td>
                    <td>{project.owners.map((owner) => owner.name).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Sheet>
      {creating && <CreateProjectModal onClose={() => setCreating(false)} />}
    </>
  )
}
