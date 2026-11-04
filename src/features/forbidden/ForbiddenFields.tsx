import type { ForbiddenInput } from '../../api/endpoints'
import type { TaskType } from '../../api/types'
import { Field, Select, TextArea, TextInput } from '../../components/ui'
import { TASK_TYPES, TASK_TYPE_LABEL } from '../../lib/labels'

/** 금지 작업 입력 칸: 작업 유형, 대상, 사유 (팀장 제안과 관리자 직접 추가가 같이 쓴다) */
export function ForbiddenFields({
  value,
  onChange,
}: {
  value: ForbiddenInput
  onChange: (next: ForbiddenInput) => void
}) {
  return (
    <>
      <Field label="작업 유형">
        {(id) => (
          <Select
            id={id}
            value={value.taskType}
            onChange={(event) => onChange({ ...value, taskType: event.target.value as TaskType })}
          >
            {TASK_TYPES.map((type) => (
              <option key={type} value={type}>
                {TASK_TYPE_LABEL[type]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="대상" hint="대상 이름에 이 글자가 들어가면 금지합니다. 예: production, prod-db">
        {(id) => (
          <TextInput id={id} value={value.target} onChange={(event) => onChange({ ...value, target: event.target.value })} />
        )}
      </Field>
      <Field label="사유">
        {(id) => (
          <TextArea
            id={id}
            rows={3}
            value={value.reason}
            onChange={(event) => onChange({ ...value, reason: event.target.value })}
          />
        )}
      </Field>
    </>
  )
}
