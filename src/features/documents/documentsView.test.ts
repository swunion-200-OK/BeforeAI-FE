import { describe, expect, it } from 'vitest'
import type { Task } from '../../api/types'
import { isDocumentsLoading, rollbackBlockedReason, rollbackTaskIds } from './documentsView'

const task = (id: string, order: number, type: Task['type'], target: string) => ({ id, order, type, target }) as Task

describe('문서 화면 로딩', () => {
  it('프로젝트가 0개면 꺼진 문서 조회를 기다리지 않는다', () => {
    expect(isDocumentsLoading({ projectsPending: false, projectCount: 0, documentsPending: true })).toBe(false)
  })

  it('프로젝트나 문서를 받는 중이면 기다린다', () => {
    expect(isDocumentsLoading({ projectsPending: true, projectCount: 0, documentsPending: true })).toBe(true)
    expect(isDocumentsLoading({ projectsPending: false, projectCount: 2, documentsPending: true })).toBe(true)
    expect(isDocumentsLoading({ projectsPending: false, projectCount: 2, documentsPending: false })).toBe(false)
  })
})

describe('롤백에 보낼 작업', () => {
  it('이 문서를 가리키는 문서 작업만 고른다', () => {
    const plan = { tasks: [task('a', 1, 'CODE_MINOR', 'docs/README.md'), task('b', 2, 'DOC', 'docs/README.md'), task('c', 3, 'DOC', 'docs/other.md')] }
    expect(rollbackTaskIds(plan, 'docs/README.md')).toEqual(['b'])
  })

  it('같은 문서를 가리키는 작업은 서버가 함께 받지 않으므로 마지막 하나만 보낸다', () => {
    const plan = { tasks: [task('a', 1, 'DOC', 'docs/README.md'), task('b', 2, 'DOC', 'docs/README.md')] }
    expect(rollbackTaskIds(plan, 'docs/README.md')).toEqual(['b'])
  })

  it('없으면 비운다', () => {
    expect(rollbackTaskIds(null, 'docs/README.md')).toEqual([])
    expect(rollbackTaskIds({ tasks: [] }, 'docs/README.md')).toEqual([])
  })
})

describe('롤백을 막는 이유', () => {
  const base = { appliedBy: 'r1', requestPending: false, requestStatus: 'COMPLETED' as const, taskIds: ['t1'] }

  it('요청과 작업을 찾았고 상태가 맞으면 막지 않는다', () => {
    expect(rollbackBlockedReason(base)).toBeNull()
  })

  it.each([
    ['적용한 요청이 없음', { appliedBy: null }, '요청이 없어'],
    ['요청을 받는 중', { requestPending: true, requestStatus: undefined }, '확인하는 중'],
    ['요청을 볼 수 없음', { requestStatus: undefined }, '볼 수 없어'],
    ['진행 중인 요청', { requestStatus: 'RUNNING' as const }, '실행중 상태'],
    ['작업을 찾지 못함', { taskIds: [] }, '작업을 찾지 못해'],
  ])('%s', (_name, change, expected) => {
    expect(rollbackBlockedReason({ ...base, ...change })).toContain(expected)
  })
})
