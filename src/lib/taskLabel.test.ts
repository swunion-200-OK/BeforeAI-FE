import { describe, expect, it } from 'vitest'
import { taskDeleteTitle, taskEditTitle, taskNumber, tasksTopic } from './taskLabel'

const serverTasks = [
  { id: 'a', order: 0 },
  { id: 'b', order: 1 },
  { id: 'c', order: 2 },
]
const mockTasks = [
  { id: 'a', order: 1 },
  { id: 'b', order: 2 },
]

describe('작업 번호', () => {
  it('서버의 0부터 시작하는 order도 1부터 보여 준다', () => {
    expect(serverTasks.map((task) => taskNumber(task, serverTasks))).toEqual([1, 2, 3])
  })

  it('목의 1부터 시작하는 order도 같다', () => {
    expect(mockTasks.map((task) => taskNumber(task, mockTasks))).toEqual([1, 2])
  })

  it('작업을 지워 order에 빈자리가 있어도 이어서 센다', () => {
    const tasks = [{ id: 'a', order: 0 }, { id: 'c', order: 2 }]
    expect(taskNumber(tasks[1], tasks)).toBe(2)
  })

  it('문장에 작업 0이 나오지 않고 조사가 맞는다', () => {
    expect(tasksTopic([serverTasks[0]], serverTasks)).toBe('작업 1은')
    expect(tasksTopic([serverTasks[1]], serverTasks)).toBe('작업 2는')
    expect(tasksTopic([serverTasks[0], serverTasks[2]], serverTasks)).toBe('작업 1, 3은')
  })
})

describe('창 제목', () => {
  it('UUID 대신 작업 제목을 쓴다', () => {
    const task = { id: '4fd64a23-0000-4000-8000-000000000000', title: '로그인 문구 수정' }
    expect(taskEditTitle(task)).toBe('작업 수정: 로그인 문구 수정')
    expect(taskDeleteTitle(task)).toBe('작업 삭제: 로그인 문구 수정')
    expect(taskEditTitle(task)).not.toContain(task.id)
  })
})
