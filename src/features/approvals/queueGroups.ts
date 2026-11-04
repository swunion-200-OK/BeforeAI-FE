import type { PendingApproval, Risk } from '../../api/types'

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

const RISK_RANK: Record<Risk, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, FORBIDDEN: 3 }

/** 목록 한 줄의 제목과 배지는 요청에서 위험도가 가장 높은 작업을 따른다. */
export function riskiestTask(group: QueueGroup): PendingApproval {
  return group.tasks.reduce((top, task) => (RISK_RANK[task.risk] > RISK_RANK[top.risk] ? task : top))
}

const ONE_HOUR_MS = 60 * 60 * 1000

/** 한 시간을 넘긴 요청은 눈에 띄게 한다. */
export function isOverdue(since: string): boolean {
  return Date.now() - new Date(since).getTime() > ONE_HOUR_MS
}
