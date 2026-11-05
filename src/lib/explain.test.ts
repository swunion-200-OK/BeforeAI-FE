import { describe, expect, it } from 'vitest'
import type { Task, TaskExplanation } from '../api/types'
import { diffStats, explanationOf, explainTask } from './explain'

const task = (fields: Partial<Task>): Task =>
  ({ id: 't', order: 1, type: 'DEPLOY', risk: 'HIGH', title: '배포', target: 'kr-main', content: {}, ...fields }) as Task

describe('서버가 설명을 주지 않을 때', () => {
  it('서버가 준 설명은 그대로 쓴다', () => {
    const explanation: TaskExplanation = { summary: 'AI 설명', changes: [], impact: ['영향'], undo: '되돌리기' }
    expect(explanationOf(task({ explanation }))).toBe(explanation)
  })

  it('배포를 안전하다고 말하지 않는다', () => {
    const text = JSON.stringify(explanationOf(task({ content: { command: './deploy.sh kr-main' } })))
    expect(text).toContain('kr-main')
    expect(text).not.toMatch(/영향이 없|스테이징|순차 재시작/)
  })

  it('쿼리를 읽기 전용이라고 단정하지 않는다', () => {
    const text = JSON.stringify(explanationOf(task({ type: 'DATA_READ', content: { query: 'SELECT 1; DROP TABLE users' } })))
    expect(text).not.toMatch(/읽기만|바뀌지 않습니다/)
  })

  it('코드 변경은 diff에서 센 값만 쓴다', () => {
    const diff = '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-const ttl = 60 * 5\n+const ttl = 60 * 30\n'
    const { summary } = explanationOf(task({ type: 'CODE_FEATURE', target: 'src/a.ts', content: { diff } }))
    expect(summary).toContain('추가 1줄, 삭제 1줄')
    expect(summary).not.toContain('세션')
  })

  it('목 서버의 설명은 그대로다', () => {
    expect(explainTask(task({ content: { command: './deploy.sh staging' }, target: 'staging' })).summary).toContain('스테이징')
  })
})

describe('형식이 틀린 코드 diff', () => {
  const malformed = '--- a/a\n+++ b/a\n@@ -1,1 +1,1 @@\n a\n-b\n+c\n+d\n'

  it('통계가 형식 오류를 알린다', () => {
    expect(diffStats(malformed).wellFormed).toBe(false)
    expect(diffStats('--- a/a\n+++ b/a\n@@ -1 +1 @@\n-b\n+c\n')).toEqual({ files: 1, added: 1, removed: 1, wellFormed: true })
  })

  it('서버 작업 설명이 추가 0줄, 삭제 0줄이라고 말하지 않는다', () => {
    const { summary } = explanationOf({ title: '수정', target: 'a', content: { diff: malformed } } as Task)
    expect(summary).toContain('줄 수를 셀 수 없습니다')
    expect(summary).not.toContain('0줄')
  })
})
