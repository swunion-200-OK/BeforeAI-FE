import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { requestsApi } from '../api/endpoints'
import type { ProgressNode, RequestApproval, RequestDetail, RequirementStatus, Task, TaskApprovalStatus } from '../api/types'
import { useMe } from '../app/AuthProvider'
import { useProjects } from './queries'

/** 이름을 모르는 승인자의 도장. 지어낸 이름 대신 역할만 쓴다. */
const UNKNOWN_APPROVER = '승인자'

/** 승인 하나가 어느 규칙 칸에 들어가는지. 대신할 사람이 적은 규칙부터 채운다. 서버는 규칙별로 기록하지 않아 후보 목록으로 맞춘다. */
function pickRequirement(open: RequirementStatus[], candidateIds: Map<RequirementStatus, string[] | undefined>, approverId: string) {
  const rivals = (item: RequirementStatus) => candidateIds.get(item)?.length ?? Number.MAX_SAFE_INTEGER
  const qualified = open.filter((item) => item.rule === 'ANYONE' || candidateIds.get(item)?.includes(approverId))
  return [...qualified].sort((a, b) => rivals(a) - rivals(b))[0] ?? open[0]
}

/** 후보 중 일부만 이름을 알면 그 사람만 기다리는 것처럼 읽힌다. 모두 알 때만 이름을 쓰고, 아니면 화면이 규칙 이름을 쓰게 비운다. */
function knownCandidates(ids: string[] | undefined, nameOf: (userId: string) => string | undefined) {
  const named = (ids ?? []).flatMap((id) => {
    const name = nameOf(id)
    return name ? [{ id, name }] : []
  })
  return named.length === ids?.length ? named : []
}

function taskStatus(
  task: Task,
  approvals: RequestApproval[],
  requesterId: string,
  nameOf: (userId: string) => string | undefined,
): TaskApprovalStatus {
  const candidateIds = new Map<RequirementStatus, string[] | undefined>()
  const requirements = task.requiredApprovers.map((requirement) => {
    const status: RequirementStatus = {
      rule: requirement.rule,
      count: requirement.count,
      candidates: knownCandidates(requirement.candidates, nameOf),
      approvedBy: [],
      satisfied: false,
    }
    candidateIds.set(status, requirement.candidates)
    return status
  })
  const signers = new Set<string>()
  for (const approval of approvals) {
    // 같은 사람이 두 번 제출해도 서버는 한 명으로 센다 (ApprovalPolicy.satisfied).
    if (!approval.taskIds.includes(task.id) || signers.has(approval.approverId)) continue
    signers.add(approval.approverId)
    const open = requirements.filter((item) => item.approvedBy.length < Math.max(1, item.count))
    if (open.length === 0) continue
    pickRequirement(open, candidateIds, approval.approverId).approvedBy.push({
      userId: approval.approverId,
      name: nameOf(approval.approverId) ?? UNKNOWN_APPROVER,
      network: approval.network,
      at: approval.createdAt,
      self: approval.approverId === requesterId,
    })
  }
  for (const item of requirements) item.satisfied = item.approvedBy.length >= Math.max(1, item.count)
  return { taskId: task.id, requirements }
}

/**
 * 작업별 승인 현황. 서버 상세에는 승인 기록(approvals)과 필요 승인권자(requiredApprovers)만 있어 여기서 맞춘다.
 * 금지 작업은 승인 대상이 아니라 뺀다. 기록이 있어야 충족으로 보므로 받지 못한 승인을 모였다고 말하지 않는다.
 */
export function deriveApprovalStatuses(
  request: Pick<RequestDetail, 'currentPlan' | 'approvals' | 'requester'>,
  nameOf: (userId: string) => string | undefined,
): TaskApprovalStatus[] {
  const plan = request.currentPlan
  if (!plan) return []
  const approvals = request.approvals.filter((approval) => approval.planId === plan.id)
  return plan.tasks
    .filter((task) => task.risk !== 'FORBIDDEN' && task.status !== 'BLOCKED')
    .map((task) => taskStatus(task, approvals, request.requester.id, nameOf))
}

/** 트리의 승인 노드 ID는 끝이 approval:{승인 기록 id}이고 label이 승인자 이름이다. 상세에는 없는 이름을 여기서 얻는다. */
export function approverNamesFromTree(root: ProgressNode, approvals: RequestApproval[]): Map<string, string> {
  const names = new Map<string, string>()
  const walk = (node: ProgressNode) => {
    if (node.type === 'APPROVAL' && node.label) {
      const approval = approvals.find((item) => node.id.endsWith(`approval:${item.id}`))
      if (approval) names.set(approval.approverId, node.label)
    }
    if ('children' in node) node.children.forEach(walk)
  }
  walk(root)
  return names
}

/**
 * 화면용 승인 현황. 서버는 사람을 ID로만 주므로 아는 이름만 쓴다: 나, 요청자, 프로젝트 담당자, 트리에 적힌 승인자.
 * 진행 상황 트리와 같은 쿼리를 쓰므로 스트림으로 바뀐 내용도 따라간다.
 */
export function useApprovalStatuses(request: RequestDetail | undefined): TaskApprovalStatus[] {
  const me = useMe()
  const projects = useProjects()
  const requestId = request?.id
  const hasApprovals = Boolean(request && request.approvals.length > 0)
  const tree = useQuery({
    queryKey: ['progress', requestId],
    queryFn: () => requestsApi.progress(requestId as string),
    enabled: hasApprovals,
  })
  const projectId = request?.projectId
  const owners = projects.data?.find((project) => project.id === projectId)?.owners
  const root = tree.data?.root
  return useMemo(() => {
    if (!request) return []
    const names = new Map<string, string>(owners?.map((owner) => [owner.id, owner.name]))
    names.set(request.requester.id, request.requester.name)
    names.set(me.id, me.name)
    if (root) for (const [id, name] of approverNamesFromTree(root, request.approvals)) names.set(id, name)
    return deriveApprovalStatuses(request, (userId) => names.get(userId))
  }, [request, owners, root, me.id, me.name])
}
