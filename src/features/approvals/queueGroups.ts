import type { PendingApproval } from '../../api/types'

export interface QueueGroup {
  requestId: string
  requester: PendingApproval['requester']
  projectName: string
  requestedAt: string
  tasks: PendingApproval[]
}

/** 작업 단위 목록을 요청 단위로 묶는다. 서버가 오래 기다린 순으로 주므로 그 순서를 지킨다. */
export function groupByRequest(items: PendingApproval[]): QueueGroup[] {
  const groups = new Map<string, QueueGroup>()
  for (const item of items) {
    const group = groups.get(item.requestId)
    if (group) {
      group.tasks.push(item)
      continue
    }
    groups.set(item.requestId, {
      requestId: item.requestId,
      requester: item.requester,
      projectName: item.projectName,
      requestedAt: item.requestedAt,
      tasks: [item],
    })
  }
  return [...groups.values()]
}

const ONE_HOUR_MS = 60 * 60 * 1000

/** 한 시간을 넘긴 요청은 눈에 띄게 한다. */
export function isOverdue(since: string): boolean {
  return Date.now() - new Date(since).getTime() > ONE_HOUR_MS
}
