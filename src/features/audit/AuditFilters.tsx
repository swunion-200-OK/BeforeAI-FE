import type { AuditAction } from '../../api/types'
import { Button, Field, Select, TextInput } from '../../components/ui'
import { AUDIT_ACTION_LABEL, NETWORK_LABEL } from '../../lib/labels'
import { useDepartments, useProjects } from '../../lib/queries'
import { hasFilters, type FilterKey } from './auditFilters'

const ACTIONS = Object.keys(AUDIT_ACTION_LABEL) as AuditAction[]

export function AuditFilters({
  params,
  actors,
  onChange,
  onReset,
}: {
  params: URLSearchParams
  /** 조회된 기록에서 뽑은 사용자. 사용자 목록 API는 외부망에서 쓸 수 없다. */
  actors: Array<{ id: string; name: string }>
  onChange: (key: FilterKey, value: string) => void
  onReset: () => void
}) {
  const departments = useDepartments()
  const projects = useProjects()
  const value = (key: FilterKey) => params.get(key) ?? ''

  const actorId = value('actorId')
  const actorOptions =
    actorId && !actors.some((actor) => actor.id === actorId) ? [...actors, { id: actorId, name: actorId }] : actors

  return (
    <form
      aria-label="감사 로그 필터"
      className="mb-4 grid grid-cols-2 items-end gap-3 rounded-md border border-rule bg-sheet p-4 md:grid-cols-4"
      onSubmit={(event) => event.preventDefault()}
    >
      <Field label="사용자">
        {(id) => (
          <Select id={id} value={actorId} onChange={(event) => onChange('actorId', event.target.value)}>
            <option value="">전체</option>
            {actorOptions.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="부서">
        {(id) => (
          <Select id={id} value={value('departmentId')} onChange={(event) => onChange('departmentId', event.target.value)}>
            <option value="">전체</option>
            {departments.data?.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="프로젝트">
        {(id) => (
          <Select id={id} value={value('projectId')} onChange={(event) => onChange('projectId', event.target.value)}>
            <option value="">전체</option>
            {projects.data?.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="요청 ID">
        {(id) => (
          // URL 값이 바뀌면 key가 바뀌어 입력칸도 새 값으로 다시 그려진다.
          <TextInput
            key={value('requestId')}
            id={id}
            defaultValue={value('requestId')}
            placeholder="입력 후 Enter"
            onBlur={(event) => onChange('requestId', event.target.value.trim())}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onChange('requestId', event.currentTarget.value.trim())
            }}
          />
        )}
      </Field>
      <Field label="액션">
        {(id) => (
          <Select id={id} value={value('action')} onChange={(event) => onChange('action', event.target.value)}>
            <option value="">전체</option>
            {ACTIONS.map((action) => (
              <option key={action} value={action}>
                {AUDIT_ACTION_LABEL[action]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="접속 환경">
        {(id) => (
          <Select id={id} value={value('network')} onChange={(event) => onChange('network', event.target.value)}>
            <option value="">전체</option>
            <option value="INTERNAL">{NETWORK_LABEL.INTERNAL}</option>
            <option value="EXTERNAL">{NETWORK_LABEL.EXTERNAL}</option>
          </Select>
        )}
      </Field>
      <Field label="시작일">
        {(id) => (
          <TextInput
            id={id}
            type="date"
            value={value('from')}
            max={value('to') || undefined}
            onChange={(event) => onChange('from', event.target.value)}
          />
        )}
      </Field>
      <Field label="종료일">
        {(id) => (
          <TextInput
            id={id}
            type="date"
            value={value('to')}
            min={value('from') || undefined}
            onChange={(event) => onChange('to', event.target.value)}
          />
        )}
      </Field>
      {hasFilters(params) && (
        <div className="col-span-full flex justify-end">
          <Button variant="ghost" size="sm" onClick={onReset}>
            필터 지우기
          </Button>
        </div>
      )}
    </form>
  )
}
