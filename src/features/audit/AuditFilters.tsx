import { useState } from 'react'
import type { AuditAction } from '../../api/types'
import { Field, Select, TextInput } from '../../components/ui'
import { AUDIT_ACTION_LABEL, NETWORK_LABEL } from '../../lib/labels'
import { useDepartments, useProjects } from '../../lib/queries'
import { isRequestIdFilter, type FilterKey } from './auditFilterParams'

const ACTIONS = Object.keys(AUDIT_ACTION_LABEL) as AuditAction[]

/** "필터" 버튼을 눌러야 펼쳐지는 상세 필터. 값은 URL과 동기화되므로 링크로 그대로 공유할 수 있다. */
export function AuditFilters({
  params,
  actors,
  onChange,
}: {
  params: URLSearchParams
  /** 조회된 기록에서 뽑은 사용자. 사용자 목록 API는 외부망에서 쓸 수 없다. */
  actors: Array<{ id: string; name: string }>
  onChange: (key: FilterKey, value: string) => void
}) {
  const departments = useDepartments()
  const projects = useProjects()
  const value = (key: FilterKey) => params.get(key) ?? ''
  const [typedInvalid, setTypedInvalid] = useState(false)
  const requestIdInvalid = typedInvalid || (value('requestId') !== '' && !isRequestIdFilter(value('requestId')))
  // 형식이 틀리면 서버에 묻지 않는다. 입력은 그대로 두고 칸 아래에 알린다.
  const commitRequestId = (typed: string) => {
    const next = typed.trim()
    if (next && !isRequestIdFilter(next)) {
      setTypedInvalid(true)
      return
    }
    setTypedInvalid(false)
    onChange('requestId', next)
  }

  const actorId = value('actorId')
  const actorOptions =
    actorId && !actors.some((actor) => actor.id === actorId) ? [...actors, { id: actorId, name: actorId }] : actors

  return (
    <form
      aria-label="감사 로그 필터"
      className="grid grid-cols-4 items-end gap-2 border-t border-rule px-4 py-2.5 2xl:grid-cols-8"
      onSubmit={(event) => event.preventDefault()}
    >
      <Field label="사용자">
        {(id) => (
          <Select className="h-9" id={id} value={actorId} onChange={(event) => onChange('actorId', event.target.value)}>
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
          <Select className="h-9" id={id} value={value('departmentId')} onChange={(event) => onChange('departmentId', event.target.value)}>
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
          <Select className="h-9" id={id} value={value('projectId')} onChange={(event) => onChange('projectId', event.target.value)}>
            <option value="">전체</option>
            {projects.data?.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="요청 ID" error={requestIdInvalid ? '요청 ID 형식이 올바르지 않습니다' : null}>
        {(id) => (
          // URL 값이 바뀌면 key가 바뀌어 입력칸도 새 값으로 다시 그려진다.
          <TextInput
            className="h-9"
            key={value('requestId')}
            id={id}
            defaultValue={value('requestId')}
            placeholder="입력 후 Enter"
            onBlur={(event) => commitRequestId(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitRequestId(event.currentTarget.value)
            }}
          />
        )}
      </Field>
      <Field label="액션">
        {(id) => (
          <Select className="h-9" id={id} value={value('action')} onChange={(event) => onChange('action', event.target.value)}>
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
          <Select className="h-9" id={id} value={value('network')} onChange={(event) => onChange('network', event.target.value)}>
            <option value="">전체</option>
            <option value="INTERNAL">{NETWORK_LABEL.INTERNAL}</option>
            <option value="EXTERNAL">{NETWORK_LABEL.EXTERNAL}</option>
          </Select>
        )}
      </Field>
      <Field label="시작일">
        {(id) => (
          <TextInput
            className="h-9"
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
            className="h-9"
            id={id}
            type="date"
            value={value('to')}
            min={value('from') || undefined}
            onChange={(event) => onChange('to', event.target.value)}
          />
        )}
      </Field>
    </form>
  )
}
