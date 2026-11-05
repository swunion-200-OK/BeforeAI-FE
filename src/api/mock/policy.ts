import type {
  ApprovalMatrixRow,
  ApproverRequirement,
  ApproverRule,
  PolicyPreset,
  Project,
  Risk,
  Task,
  TaskApprovalStatus,
  TaskContent,
  TaskType,
  UserRef,
} from '../types'
import { db, requireProject, type StoredRequest, type StoredUser } from './store'

/**
 * 승인 기준표(기능 명세서 5.2)와 규모별 프리셋(5.5)으로 필요한 승인 규칙을 정한다.
 * 규칙마다 1명이다. 웹 서비스는 서비스 정책으로, 웹쉘은 웹쉘 정책의 사본으로 각자 계산한다.
 */
export function requiredRules(
  type: TaskType,
  risk: Risk,
  preset: PolicyPreset,
  matrix: ApprovalMatrixRow[],
): ApproverRule[] {
  if (risk === 'FORBIDDEN') return []
  const row = matrix.find((m) => m.taskType === type)
  // 위험도는 기준표의 기본값보다 내릴 수 없다 (5.2). 기준표에 없는 유형은 가장 엄격하게 본다.
  if (risk === 'HIGH' || (row?.defaultRisk ?? 'HIGH') === 'HIGH') {
    const rules: ApproverRule[] = ['PROJECT_OWNER']
    if (preset !== 'SMALL') rules.push('DEPT_MANAGER')
    if (preset === 'LARGE') rules.push('ADMIN')
    return rules
  }
  if (row?.approverRule === 'PROJECT_OWNER') return ['PROJECT_OWNER']
  return [preset === 'LARGE' ? 'SAME_DEPT_OTHER' : 'ANYONE']
}

function candidatesOf(rule: ApproverRule, project: Project, requester: UserRef): string[] | undefined {
  const active = db().users.filter((u) => u.active)
  const ids = (users: typeof active) => users.map((u) => u.id)
  switch (rule) {
    case 'ANYONE':
      return undefined
    case 'PROJECT_OWNER':
      return project.owners.map((o) => o.id)
    case 'DEPT_MANAGER':
      return ids(active.filter((u) => u.role === 'DEPT_MANAGER' && u.departmentId === project.departmentId))
    case 'ADMIN':
      return ids(active.filter((u) => u.role === 'ADMIN'))
    case 'SAME_DEPT_OTHER':
      return ids(active.filter((u) => u.departmentId === requester.departmentId && u.id !== requester.id))
  }
}

export function buildRequiredApprovers(
  project: Project,
  requester: UserRef,
  type: TaskType,
  risk: Risk,
): ApproverRequirement[] {
  const { policy, matrix } = db()
  return requiredRules(type, risk, policy.preset, matrix).map((rule) => {
    const candidates = candidatesOf(rule, project, requester)
    return candidates ? { rule, count: 1, candidates } : { rule, count: 1 }
  })
}

export function qualifies(
  user: StoredUser,
  rule: ApproverRule,
  request: Pick<StoredRequest, 'projectId' | 'requester'>,
): boolean {
  if (!user.active) return false
  const project = requireProject(request.projectId)
  switch (rule) {
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
  const open = task.requiredApprovers.filter(
    (requirement) =>
      approvalsFor(request, task.id, requirement.rule).length < requirement.count &&
      qualifies(user, requirement.rule, request),
  )
  // 두 규칙에 다 해당하면 대신할 사람이 적은 쪽에 센다. 담당자를 겸한 부서 관리자가 먼저 서명해도 부서 관리자 칸이 막히지 않는다.
  const rivals = (requirement: ApproverRequirement) => requirement.candidates?.length ?? Number.MAX_SAFE_INTEGER
  return open.sort((a, b) => rivals(a) - rivals(b))[0] ?? null
}

export function isTaskFullyApproved(task: Task, request: StoredRequest): boolean {
  return task.requiredApprovers.every(
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
    task.requiredApprovers.every((r) => r.rule === 'ANYONE')
  )
}

export function toApprovalStatus(request: StoredRequest): TaskApprovalStatus[] {
  if (!request.plan) return []
  const { users } = db()
  return request.plan.tasks
    .filter((task) => task.status !== 'BLOCKED')
    .map((task) => ({
      taskId: task.id,
      requirements: task.requiredApprovers.map((requirement) => {
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
      task.requiredApprovers.some((requirement) => qualifies(user, requirement.rule, request)),
  )
}

/**
 * 금지 규칙의 대상이 작업 대상이나 실제로 돌아갈 명령·쿼리에 들어 있는지 본다. 서비스와 웹쉘이 같은 기준을 쓴다.
 * 명령과 쿼리는 낱말 단위로 봐서 prod가 products에 걸리지 않게 한다.
 */
export function hitsForbiddenTarget(ruleTarget: string, target: string, content: TaskContent): boolean {
  if (ruleTarget === '*') return true
  const word = ruleTarget.toLowerCase()
  if (target.toLowerCase().includes(word)) return true
  const pattern = new RegExp(`(^|[^a-z0-9_-])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9_-])`)
  return [content.command, content.query].some((text) => text !== undefined && pattern.test(text.toLowerCase()))
}

export function findForbiddenReason(
  type: TaskType,
  target: string,
  departmentIds: string[],
  content: TaskContent,
): string | null {
  const rule = db().forbiddenRules.find(
    (r) => departmentIds.includes(r.departmentId) && r.taskType === type && hitsForbiddenTarget(r.target, target, content),
  )
  return rule ? rule.reason : null
}
