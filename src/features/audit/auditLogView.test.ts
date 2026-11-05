import { describe, expect, it } from 'vitest'
import { actorName, actorOptions } from './auditLogView'

describe('행위자 없는 감사 기록', () => {
  it('시스템 기록은 이름 자리에 시스템이라고 쓴다', () => {
    expect(actorName({ actor: null })).toBe('시스템')
    expect(actorName({ actor: { id: 'u1', name: '김담당' } })).toBe('김담당')
  })

  it('사용자 필터 목록에서 빼고 겹치지 않게 모은다', () => {
    const kim = { id: 'u1', name: '김담당' }
    const lee = { id: 'u2', name: '가나다' }
    expect(actorOptions([{ actor: kim }, { actor: null }, { actor: lee }, { actor: kim }])).toEqual([lee, kim])
  })
})
