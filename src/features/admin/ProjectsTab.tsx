import { useMutation, useQuery } from '@tanstack/react-query'
import { BookText, FolderPlus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { adminApi } from '../../api/endpoints'
import { Avatar, UserChip } from '../../components/rich'
import { toast } from '../../components/toast'
import { EmptyState, Button, ErrorState, Field, Mono, Select, Sheet, Spinner, TextArea, TextInput } from '../../components/ui'
import { useDepartmentNames, useDepartments, useProjects, useRefreshAll } from '../../lib/queries'
import { usersQuery } from './adminQueries'

const MIN_OWNERS = 2

function CreateProjectForm() {
  const refresh = useRefreshAll()
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
    <Sheet title="프로젝트 생성" icon={<FolderPlus size={16} aria-hidden />}>
      <form
        className="grid gap-3 md:grid-cols-2"
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
          <div className="grid gap-1 sm:grid-cols-2">
            {users.data
              ?.filter((user) => user.active)
              .map((user) => {
                const checked = ownerIds.includes(user.id)
                return (
                  <label
                    key={user.id}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-sm ${
                      checked ? 'border-seal bg-seal-soft/40' : 'border-rule hover:bg-sheet-alt'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="accent-seal"
                      checked={checked}
                      onChange={(event) => toggleOwner(user.id, event.target.checked)}
                    />
                    <Avatar name={user.name} size="sm" />
                    <span className="min-w-0 truncate">
                      {user.name}
                      <span className="ml-1.5 text-xs text-ink-3">{departmentName(user.departmentId)}</span>
                    </span>
                  </label>
                )
              })}
          </div>
          <p className={`mt-1 text-xs ${lackingOwners ? 'text-high' : 'text-ink-3'}`}>
            {ownerIds.length}명 선택함. 담당자는 데이터 수정·DB 접근·배포 작업을 승인합니다.
          </p>
        </fieldset>
        <div className="md:col-span-2">
          <Field label="초기 기획서" hint="AI가 이 프로젝트를 분석할 때 컨텍스트로 씁니다">
            {(id) => <TextArea id={id} rows={5} value={specBody} onChange={(event) => setSpecBody(event.target.value)} />}
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
  const count = projects.data?.length
  return (
    <Sheet
      title={count === undefined ? '등록된 프로젝트' : `등록된 프로젝트 ${count}개`}
      icon={<BookText size={16} aria-hidden />}
      flush
    >
      {projects.isPending && <Spinner />}
      {projects.isError && <ErrorState error={projects.error} onRetry={() => projects.refetch()} />}
      {projects.data?.length === 0 && <EmptyState title="등록된 프로젝트가 없습니다">왼쪽 폼에서 첫 프로젝트를 만드세요.</EmptyState>}
      {projects.data && projects.data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="sheet-table">
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
                    <Link to={`/projects/${project.id}`} className="font-medium text-seal hover:underline">
                      {project.name}
                    </Link>
                    <div className="mt-0.5">
                      <Mono className="text-ink-3">{project.repository}</Mono>
                    </div>
                  </td>
                  <td className="whitespace-nowrap">{departmentName(project.departmentId)}</td>
                  <td>
                    <span className="flex flex-wrap gap-x-3 gap-y-1">
                      {project.owners.map((owner) => (
                        <UserChip key={owner.id} name={owner.name} />
                      ))}
                    </span>
                  </td>
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
    <div className="grid items-start gap-4 xl:grid-cols-2">
      <CreateProjectForm />
      <ProjectList />
    </div>
  )
}
