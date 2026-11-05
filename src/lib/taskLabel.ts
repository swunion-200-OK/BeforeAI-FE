import type { Task } from '../api/types'

type Numbered = Pick<Task, 'id' | 'order'>

/**
 * 화면에 쓰는 작업 번호. 1부터 센다. order 값은 그대로 쓰지 않는다:
 * 서버는 AI 분석 Plan을 0부터, 롤백 Plan을 1부터 매기고, order는 해시 대상이라 고칠 수 없다.
 */
export function taskNumber(task: Numbered, tasks: readonly Numbered[]): number {
  return [...tasks].sort((a, b) => a.order - b.order).findIndex((item) => item.id === task.id) + 1
}

/** "작업 1, 3은" 처럼 번호에 맞는 조사를 붙인다. 1·3·6·7·8·0으로 끝나면 받침이 있다. 작업 ID는 UUID라 문장에 쓰지 않는다. */
export function tasksTopic(subset: readonly Numbered[], tasks: readonly Numbered[]): string {
  const numbers = subset.map((task) => String(taskNumber(task, tasks)))
  return `작업 ${numbers.join(', ')}${/[136780]$/.test(numbers[numbers.length - 1]) ? '은' : '는'}`
}

/** 창 제목. 사람이 알아볼 수 있는 작업 제목을 쓴다. */
export const taskEditTitle = (task: Pick<Task, 'title'>) => `작업 수정: ${task.title}`
export const taskDeleteTitle = (task: Pick<Task, 'title'>) => `작업 삭제: ${task.title}`
