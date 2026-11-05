import { isStreamDenied, POLL_AFTER_FAILURES, RECONNECT_BASE_MS, RECONNECT_MAX_MS, reconnectDelay } from '../../api/sse'
import type { ProgressStreamEvent, ProgressTree } from '../../api/types'
import { applyProgressEvent } from '../../lib/progressTree'

export { RECONNECT_BASE_MS, RECONNECT_MAX_MS }

export interface ProgressSyncDeps {
  getTree: () => ProgressTree | undefined
  setTree: (tree: ProgressTree) => void
  /** 트리 전체를 다시 받아 저장한다. 실패는 호출한 쪽의 쿼리 상태로 나타난다 */
  fetchTree: () => Promise<unknown>
  /** 트리를 조용히 읽기만 한다. 스트림이 안 될 때 쓰며, 일시적인 실패로 보던 트리가 오류 화면으로 바뀌면 안 된다 */
  readTree: () => Promise<ProgressTree>
  openStream: (onEvent: (event: ProgressStreamEvent) => void, signal: AbortSignal, lastVersion?: number) => Promise<void>
}

/**
 * 트리 전체를 받은 뒤 스트림으로 바뀐 노드만 반영한다 (명세 4.9).
 * tree.replaced, 빠진 버전, 반영할 곳을 찾지 못한 패치는 전체를 다시 받고, 그동안 온 이벤트는 모았다가 이어서 반영한다.
 * 스트림이 끊기면 점점 긴 간격으로 다시 연결하고, 이벤트를 받으면 간격을 처음으로 되돌린다.
 * 연결이 계속 안 되면 다시 연결할 때마다 트리도 읽어 화면이 멈춰 있지 않게 한다.
 */
export function createProgressSync({ getTree, setTree, fetchTree, readTree, openStream }: ProgressSyncDeps) {
  const controller = new AbortController()
  const { signal } = controller
  let refetching = false
  let queued: ProgressStreamEvent[] = []
  let failures = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const refetch = () => {
    if (refetching) return
    refetching = true
    fetchTree()
      .catch(() => {})
      .then(() => {
        refetching = false
        const pending = queued
        queued = []
        pending.forEach(receive)
      })
  }

  const receive = (event: ProgressStreamEvent) => {
    if (signal.aborted) return
    failures = 0
    if (event.event === 'heartbeat') return
    if (refetching) {
      queued.push(event)
      return
    }
    if (event.event === 'tree.replaced') {
      refetch()
      return
    }
    const current = getTree()
    if (!current || event.id > current.version + 1) {
      refetch()
      return
    }
    if (event.id <= current.version) return
    const next = applyProgressEvent(current, event)
    if (next) setTree(next)
    else refetch()
  }

  const poll = () => {
    if (refetching) return
    readTree().then(
      (tree) => {
        if (signal.aborted) return
        const current = getTree()
        if (!current || tree.version >= current.version) setTree(tree)
      },
      (reason: unknown) => {
        // 볼 수 없게 됐으면 쿼리 상태로 화면에 알린다.
        if (isStreamDenied(reason)) refetch()
      },
    )
  }

  const connect = () => {
    openStream(receive, signal, getTree()?.version)
      .then(
        () => null,
        (reason: unknown) => reason,
      )
      .then((reason) => {
        if (signal.aborted) return
        if (isStreamDenied(reason)) {
          refetch()
          return
        }
        const delay = reconnectDelay(failures)
        failures += 1
        if (failures >= POLL_AFTER_FAILURES) poll()
        timer = setTimeout(connect, delay)
      })
  }

  return {
    start: connect,
    stop() {
      controller.abort()
      clearTimeout(timer)
    },
  }
}
