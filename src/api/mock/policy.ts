import type {
  ApproverRequirement,
  ApproverRule,
  Project,
  RequiredApprovers,
  Risk,
  Task,
  TaskApprovalStatus,
  TaskType,
  UserRef,
} from '../types'
import { db, requireProject, type StoredRequest, type StoredUser } from './store'

/** 기능 명세서 5.2 승인 기준표 + 5.5 규모별 프리셋 */
export function buildRequiredApprovers(
  project: Project,
  requester: UserRef,
  type: TaskType,
  risk: Risk,
): RequiredApprovers {
  if (risk === 'FORBIDDEN') return { rule: 'ANYONE', count: 0 }
  const { policy, matrix, users } = db()

  if (risk === 'HIGH') {
    const list: ApproverRequirement[] = [
      { rule: 'PROJECT_OWNER', count: 1, candidates: project.owners.map((o) => o.id) },
    ]
    if (policy.preset !== 'SMALL') {
      list.push({
        rule: 'DEPT_MANAGER',
        count: 1,
        candidates: users
          .filter((u) => u.role === 'DEPT_MANAGER' && u.departmentId === project.departmentId && u.active)
          .map((u) => u.id),
      })
    }
    if (policy.preset === 'LARGE') {
      list.push({
        rule: 'ADMIN',
        count: 1,
        candidates: users.filter((u) => u.role === 'ADMIN' && u.active).map((u) => u.id),
      })
    }
    const [first, ...additional] = list
    return additional.length ? { ...first, additional } : first
  }

  const row = matrix.find((m) => m.taskType === type)
  const rule: ApproverRule = row?.approverRule ?? 'ANYONE'
  if (rule === 'PROJECT_OWNER') {
    return { rule, count: 1, candidates: project.owners.map((o) => o.id) }
  }
  if (policy.preset === 'LARGE') {
    return {
      rule: 'SAME_DEPT_OTHER',
      count: 1,
      candidates: users
        .filter((u) => u.departmentId === requester.departmentId && u.id !== requester.id && u.active)
        .map((u) => u.id),
    }
  }
  return { rule: 'ANYONE', count: 1 }
}

export function requirementsOf(task: Task): ApproverRequirement[] {
  const { additional, ...first } = task.requiredApprovers
  return [first, ...(additional ?? [])]
}

export function qualifies(user: StoredUser, requirement: ApproverRequirement, request: StoredRequest): boolean {
  if (!user.active) return false
  const project = requireProject(request.projectId)
  switch (requirement.rule) {
    case 'ANYONE':
      return true
    case 'SAME_DEPT_OTHER':
      return user.departmentId === request.requester.departmentId && user.id !== request.requester.id
    case 'PROJECT_OWNER':
      return project.owners.some((o) => o.id === user.id)
    case 'DEPT_MANAGER':
      return user.role === 'DEPT_MANAGER' && user.departmentId === project.departmentId
    case 'ADMIN':
      return user.role === 'ADMIN'
  }
}

function approvalsFor(request: StoredRequest, taskId: string, rule: ApproverRule) {
  return request.approvals.filter(
    (a) => a.planId === request.currentPlanId && a.taskId === taskId && a.rule === rule,
  )
}

/** 이 사용자의 서명을 어느 규칙에 셀지 고른다. 이미 찬 규칙과 이미 서명한 작업은 뺀다. */
export function matchRequirement(
  user: StoredUser,
  task: Task,
  request: StoredRequest,
): ApproverRequirement | null {
  const signed = request.approvals.some(
    (a) => a.planId === request.currentPlanId && a.taskId === task.id && a.userId === user.id,
  )
  if (signed) return null
  for (const requirement of requirementsOf(task)) {
    const filled = approvalsFor(request, task.id, requirement.rule).length >= requirement.count
    if (!filled && qualifies(user, requirement, request)) return requirement
  }
  return null
}

export function isTaskFullyApproved(task: Task, request: StoredRequest): boolean {
  return requirementsOf(task).every(
    (requirement) => approvalsFor(request, task.id, requirement.rule).length >= requirement.count,
  )
}

/** 외부망에서 승인할 수 있는 작업: 코드 수정이고 위험도 낮음·중간 (5.6) */
export function isExternallyApprovable(task: Task): boolean {
  return (task.type === 'CODE_MINOR' || task.type === 'CODE_FEATURE') && (task.risk === 'LOW' || task.risk === 'MEDIUM')
}

/**
 * 제출과 함께 본인 승인이 되는 작업.
 * TODO(spec): 문서 작업은 완성본을 보고 적용/미적용을 정해야 하므로(5.4) 자동 승인에서 뺐다.
 */
export function isSelfApprovable(task: Task): boolean {
  return (
    task.status === 'PENDING' &&
    task.type !== 'DOC' &&
    (task.risk === 'LOW' || task.risk === 'MEDIUM') &&
    requirementsOf(task).every((r) => r.rule === 'ANYONE')
  )
}

export function toApprovalStatus(request: StoredRequest): TaskApprovalStatus[] {
  if (!request.plan) return []
  const { users } = db()
  return request.plan.tasks
    .filter((task) => task.status !== 'BLOCKED')
    .map((task) => ({
      taskId: task.id,
      requirements: requirementsOf(task).map((requirement) => {
        const approvedBy = approvalsFor(request, task.id, requirement.rule).map((a) => ({
          userId: a.userId,
          name: a.name,
          network: a.network,
          at: a.at,
          self: a.self,
        }))
        return {
          rule: requirement.rule,
          count: requirement.count,
          candidates: (requirement.candidates ?? []).map((id) => ({
            id,
            name: users.find((u) => u.id === id)?.name ?? id,
          })),
          approvedBy,
          satisfied: approvedBy.length >= requirement.count,
        }
      }),
    }))
}

export function isCandidate(user: StoredUser, request: StoredRequest): boolean {
  if (!request.plan) return false
  return request.plan.tasks.some(
    (task) =>
      task.status !== 'BLOCKED' &&
      requirementsOf(task).some((requirement) => qualifies(user, requirement, request)),
  )
}

export function findForbiddenReason(
  type: TaskType,
  target: string,
  departmentIds: string[],
): string | null {
  const rule = db().forbiddenRules.find(
    (r) =>
      departmentIds.includes(r.departmentId) &&
      r.taskType === type &&
      (r.target === '*' || target.toLowerCase().includes(r.target.toLowerCase())),
  )
  return rule ? rule.reason : null
}
