// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/errors'
import type { ProgressStreamEvent, ProgressTree } from '../../api/types'
import { applyProgressEvent } from '../../lib/progressTree'
import { createProgressSync, RECONNECT_BASE_MS, RECONNECT_MAX_MS } from './progressSync'

const tree = (version: number): ProgressTree => ({
  requestId: 'r',
  version,
  updatedAt: '',
  root: {
    id: 'request:r',
    type: 'REQUEST',
    label: '요청',
    status: 'RUNNING',
    children: [
      {
        id: 'task:a',
        type: 'TASK',
        label: '1. a',
        taskType: 'DEPLOY',
        risk: 'HIGH',
        status: 'RUNNING',
        dependsOn: [],
        children: [],
      },
    ],
  },
})
const updated = (id: number, status = 'SUCCEEDED'): ProgressStreamEvent => ({ id, event: 'node.updated', data: { nodeId: 'task:a', status, at: '' } })

function setup(initial = tree(5)) {
  let current: ProgressTree | undefined = initial
  let emit: (event: ProgressStreamEvent) => void = () => {}
  let closeStream: (reason?: unknown) => void = () => {}
  const fetchResolvers: Array<(tree: ProgressTree) => void> = []
  const fetchTree = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        fetchResolvers.push((next) => {
          current = next
          resolve()
        })
      }),
  )
  const openStream = vi.fn(
    (onEvent: (event: ProgressStreamEvent) => void, _signal: AbortSignal, _lastVersion?: number) =>
      new Promise<void>((resolve, reject) => {
        emit = onEvent
        closeStream = (reason) => (reason ? reject(reason) : resolve())
      }),
  )
  const readTree = vi.fn((): Promise<ProgressTree> => new Promise(() => {}))
  const sync = createProgressSync({ getTree: () => current, setTree: (next) => (current = next), fetchTree, readTree, openStream })
  return {
    sync,
    fetchTree,
    readTree,
    openStream,
    emit: (event: ProgressStreamEvent) => emit(event),
    close: async (reason?: unknown) => {
      closeStream(reason)
      await vi.advanceTimersByTimeAsync(0)
    },
    finishFetch: async (next: ProgressTree) => {
      fetchResolvers.shift()?.(next)
      await vi.advanceTimersByTimeAsync(0)
    },
    tree: () => current as ProgressTree,
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('패치와 전체 다시 받기', () => {
  it('다음 버전이면 반영하고, 이미 받은 버전은 무시한다', () => {
    const t = setup()
    t.sync.start()
    t.emit(updated(6))
    expect(t.tree().version).toBe(6)
    t.emit(updated(6, 'FAILED'))
    t.emit(updated(4, 'FAILED'))
    expect(t.tree().root.children[0].status).toBe('SUCCEEDED')
    expect(t.fetchTree).not.toHaveBeenCalled()
    t.sync.stop()
  })

  it('빠진 버전이 있으면 전체를 다시 받고, 그동안 온 이벤트는 이어서 반영한다', async () => {
    const t = setup()
    t.sync.start()
    t.emit(updated(8))
    expect(t.fetchTree).toHaveBeenCalledTimes(1)
    expect(t.tree().version).toBe(5)
    t.emit(updated(9, 'FAILED'))
    t.emit(updated(10, 'SUCCEEDED'))
    expect(t.fetchTree).toHaveBeenCalledTimes(1)
    await t.finishFetch(tree(8))
    expect(t.tree().version).toBe(10)
    expect(t.tree().root.children[0].status).toBe('SUCCEEDED')
    t.sync.stop()
  })

  it('전체를 받는 사이 이미 포함된 이벤트는 다시 적용하지 않는다', async () => {
    const t = setup()
    t.sync.start()
    t.emit({ id: 6, event: 'tree.replaced', data: { version: 6 } })
    t.emit(updated(7, 'FAILED'))
    await t.finishFetch(tree(7))
    expect(t.tree().version).toBe(7)
    expect(t.tree().root.children[0].status).toBe('RUNNING')
    t.sync.stop()
  })

  it('다시 받기가 실패해도 멈추지 않고 다음 이벤트로 다시 시도한다', async () => {
    const t = setup()
    t.fetchTree.mockImplementationOnce(() => Promise.reject(new Error('네트워크')))
    t.sync.start()
    t.emit({ id: 6, event: 'tree.replaced', data: { version: 6 } })
    await vi.advanceTimersByTimeAsync(0)
    t.emit(updated(9))
    expect(t.fetchTree).toHaveBeenCalledTimes(2)
    t.sync.stop()
  })

  it('트리에 없는 노드의 node.updated는 버전만 올리지 않고 전체를 다시 받는다', () => {
    const t = setup()
    const unknown: Extract<ProgressStreamEvent, { event: 'node.updated' }> = { id: 6, event: 'node.updated', data: { nodeId: 'task:없음', status: 'RUNNING', at: '' } }
    t.sync.start()
    t.emit(unknown)
    expect(t.tree().version).toBe(5)
    expect(t.fetchTree).toHaveBeenCalledTimes(1)
    expect(applyProgressEvent(tree(5), unknown)).toBeNull()
    t.sync.stop()
  })

  it('heartbeat는 트리를 건드리지 않는다', () => {
    const t = setup()
    t.sync.start()
    t.emit({ id: null, event: 'heartbeat', data: {} })
    expect(t.tree().version).toBe(5)
    expect(t.fetchTree).not.toHaveBeenCalled()
    t.sync.stop()
  })
})

describe('다시 연결', () => {
  it('깨끗하게 닫혀도 간격을 늘리고 상한을 넘지 않는다', async () => {
    const t = setup()
    t.sync.start()
    const delays: number[] = []
    for (let i = 0; i < 7; i++) {
      await t.close()
      const before = t.openStream.mock.calls.length
      let waited = 0
      while (t.openStream.mock.calls.length === before) {
        await vi.advanceTimersByTimeAsync(500)
        waited += 500
      }
      delays.push(waited)
    }
    expect(delays.slice(0, 3)).toEqual([RECONNECT_BASE_MS, RECONNECT_BASE_MS * 2, RECONNECT_BASE_MS * 4])
    expect(Math.max(...delays)).toBe(RECONNECT_MAX_MS)
    expect(delays.at(-1)).toBe(RECONNECT_MAX_MS)
    t.sync.stop()
  })

  it('이벤트를 받으면 간격이 처음으로 돌아가고, 마지막 버전으로 이어 받는다', async () => {
    const t = setup()
    t.sync.start()
    await t.close()
    await vi.advanceTimersByTimeAsync(RECONNECT_BASE_MS)
    await t.close()
    await vi.advanceTimersByTimeAsync(RECONNECT_BASE_MS * 2)
    t.emit(updated(6))
    await t.close()
    await vi.advanceTimersByTimeAsync(RECONNECT_BASE_MS)
    expect(t.openStream).toHaveBeenCalledTimes(4)
    expect(t.openStream.mock.calls.at(-1)?.[2]).toBe(6)
    t.sync.stop()
  })

  it.each([401, 403, 404])('%i이면 다시 연결하지 않고 화면에 알린다', async (status) => {
    const t = setup()
    t.sync.start()
    await t.close(new ApiError(status, 'X', 'x'))
    expect(t.fetchTree).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(RECONNECT_MAX_MS * 2)
    expect(t.openStream).toHaveBeenCalledTimes(1)
    t.sync.stop()
  })

  it.each([400, 409, 429, 500, 503])('%i는 권한 문제가 아니라 다시 연결한다', async (status) => {
    const t = setup()
    t.sync.start()
    await t.close(new ApiError(status, 'X', 'x'))
    await vi.advanceTimersByTimeAsync(RECONNECT_BASE_MS)
    expect(t.openStream).toHaveBeenCalledTimes(2)
    expect(t.fetchTree).not.toHaveBeenCalled()
    t.sync.stop()
  })

  it('네트워크 오류도 다시 연결한다', async () => {
    const t = setup()
    t.sync.start()
    await t.close(new TypeError('failed to fetch'))
    await vi.advanceTimersByTimeAsync(RECONNECT_BASE_MS)
    expect(t.openStream).toHaveBeenCalledTimes(2)
    t.sync.stop()
  })

  it('연결이 계속 안 되면 다시 연결할 때마다 트리를 조용히 읽고, 실패해도 오류 화면으로 넘기지 않는다', async () => {
    const t = setup()
    t.readTree.mockResolvedValueOnce(tree(9)).mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'x'))
    t.sync.start()
    for (const wait of [RECONNECT_BASE_MS, RECONNECT_BASE_MS * 2]) {
      await t.close(new ApiError(0, 'NETWORK_ERROR', 'x'))
      await vi.advanceTimersByTimeAsync(wait)
    }
    expect(t.readTree).not.toHaveBeenCalled()
    await t.close(new ApiError(0, 'NETWORK_ERROR', 'x'))
    expect(t.readTree).toHaveBeenCalledTimes(1)
    expect(t.tree().version).toBe(9)
    await vi.advanceTimersByTimeAsync(RECONNECT_BASE_MS * 4)
    await t.close(new ApiError(0, 'NETWORK_ERROR', 'x'))
    expect(t.readTree).toHaveBeenCalledTimes(2)
    expect(t.fetchTree).not.toHaveBeenCalled()
    t.sync.stop()
  })

  it('읽다가 볼 수 없게 됐으면 쿼리 상태로 알린다', async () => {
    const t = setup()
    t.readTree.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'x'))
    t.sync.start()
    for (const wait of [RECONNECT_BASE_MS, RECONNECT_BASE_MS * 2]) {
      await t.close(new TypeError('x'))
      await vi.advanceTimersByTimeAsync(wait)
    }
    await t.close(new TypeError('x'))
    expect(t.fetchTree).toHaveBeenCalledTimes(1)
    t.sync.stop()
  })

  it('멈추면 예약된 연결을 취소하고 스트림을 중단하며 이벤트를 무시한다', async () => {
    const t = setup()
    t.sync.start()
    const signal = t.openStream.mock.calls[0][1]
    await t.close()
    t.sync.stop()
    expect(signal.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(RECONNECT_MAX_MS * 2)
    expect(t.openStream).toHaveBeenCalledTimes(1)
    t.emit(updated(6))
    expect(t.tree().version).toBe(5)
  })
})
