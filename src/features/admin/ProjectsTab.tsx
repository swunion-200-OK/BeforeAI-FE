import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { adminApi } from '../../api/endpoints'
import { toast } from '../../components/toast'
import { EmptyState, Button, ErrorState, Field, Mono, Select, Sheet, Spinner, TextArea, TextInput } from '../../components/ui'
import { useDepartmentNames, useDepartments, useProjects, useRefreshAll } from '../../lib/queries'

const MIN_OWNERS = 2

function CreateProjectForm() {
  const refresh = useRefreshAll()
  const departments = useDepartments()
  const departmentName = useDepartmentNames()
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: async () => (await adminApi.users()).items })
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
      setName('')
      setRepository('')
      setOwnerIds([])
      setSpecBody('')
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
    <Sheet title="프로젝트 생성">
      <form
        className="grid gap-4 md:grid-cols-2"
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
        <div className="md:col-span-2">
          <Field label="저장소" hint="예: git@internal:auth-service.git">
            {(id) => (
              <TextInput
                id={id}
                className="font-mono"
                value={repository}
                onChange={(event) => setRepository(event.target.value)}
              />
            )}
          </Field>
        </div>
        <fieldset className="md:col-span-2">
          <legend className="mb-1 text-[0.8125rem] font-medium text-ink-2">담당자 (2명 이상)</legend>
          {users.isPending && <Spinner />}
          {users.isError && <ErrorState error={users.error} onRetry={() => users.refetch()} />}
          <div className="grid gap-x-3 gap-y-1 rounded-md border border-rule p-3 sm:grid-cols-2 lg:grid-cols-3">
            {users.data
              ?.filter((user) => user.active)
              .map((user) => (
                <label key={user.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="accent-seal"
                    checked={ownerIds.includes(user.id)}
                    onChange={(event) => toggleOwner(user.id, event.target.checked)}
                  />
                  {user.name}
                  <span className="text-xs text-ink-3">{departmentName(user.departmentId)}</span>
                </label>
              ))}
          </div>
          <p className={`mt-1 text-xs ${lackingOwners ? 'text-high' : 'text-ink-3'}`}>
            {ownerIds.length}명 선택함. 담당자는 데이터 수정·DB 접근·배포 작업을 승인합니다.
          </p>
        </fieldset>
        <div className="md:col-span-2">
          <Field label="초기 기획서" hint="AI가 이 프로젝트를 분석할 때 컨텍스트로 씁니다">
            {(id) => <TextArea id={id} rows={6} value={specBody} onChange={(event) => setSpecBody(event.target.value)} />}
          </Field>
        </div>
        <div className="md:col-span-2">
          <Button
            type="submit"
            variant="primary"
            disabled={Boolean(blockedReason)}
            disabledReason={blockedReason}
            loading={create.isPending}
          >
            프로젝트 생성
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

function ProjectList() {
  const projects = useProjects()
  const departmentName = useDepartmentNames()
  return (
    <Sheet title="등록된 프로젝트" flush>
      {projects.isPending && <Spinner />}
      {projects.isError && <ErrorState error={projects.error} onRetry={() => projects.refetch()} />}
      {projects.data?.length === 0 && <EmptyState title="등록된 프로젝트가 없습니다" />}
      {projects.data && projects.data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="sheet-table">
            <thead>
              <tr>
                <th>프로젝트</th>
                <th>담당 부서</th>
                <th>저장소</th>
                <th>담당자</th>
              </tr>
            </thead>
            <tbody>
              {projects.data.map((project) => (
                <tr key={project.id}>
                  <td className="font-medium whitespace-nowrap">
                    <Link to={`/projects/${project.id}`} className="text-seal hover:underline">
                      {project.name}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap">{departmentName(project.departmentId)}</td>
                  <td>
                    <Mono>{project.repository}</Mono>
                  </td>
                  <td>{project.owners.map((owner) => owner.name).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Sheet>
  )
}

export function ProjectsTab() {
  return (
    <div className="flex flex-col gap-4">
      <CreateProjectForm />
      <ProjectList />
    </div>
  )
}
