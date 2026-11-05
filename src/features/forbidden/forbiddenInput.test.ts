import { describe, expect, it } from 'vitest'
import { addRuleBlockedReason } from './forbiddenInput'

describe('금지 규칙 추가 버튼이 잠긴 이유', () => {
  const ready = { departmentsPending: false, departmentsFailed: false, hasDepartment: true, inputComplete: true }

  it('부서가 있고 입력을 마치면 잠그지 않는다', () => {
    expect(addRuleBlockedReason(ready)).toBeNull()
  })

  it('부서가 없으면 입력을 채워도 그 이유를 말한다', () => {
    expect(addRuleBlockedReason({ ...ready, hasDepartment: false })).toContain('부서를 먼저 만들어')
  })

  it('부서를 받는 중이면 부서가 없다고 하지 않는다', () => {
    expect(addRuleBlockedReason({ ...ready, departmentsPending: true, hasDepartment: false })).toContain('불러오는 중')
  })

  it('부서를 받지 못했으면 부서가 없다고 하지 않는다', () => {
    expect(addRuleBlockedReason({ ...ready, departmentsFailed: true, hasDepartment: false })).toContain('불러오지 못했습니다')
  })

  it('입력이 비었으면 입력을 요청한다', () => {
    expect(addRuleBlockedReason({ ...ready, inputComplete: false })).toContain('대상과 사유')
  })
})
