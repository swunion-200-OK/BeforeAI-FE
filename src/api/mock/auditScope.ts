import type { AuditLog } from '../types'
import { db, requireProject, type StoredRequest, type StoredUser } from './store'

export function inDepartment(request: StoredRequest, departmentId: string | null): boolean {
  if (!departmentId) return false
  return (
    request.requester.departmentId === departmentId || requireProject(request.projectId).departmentId === departmentId
  )
}

/** 역할별 감사 로그 범위: 관리자 전체, 부서 관리자 소속 부서, 직원 본인 요청 */
export function auditInScope(log: AuditLog, user: StoredUser): boolean {
  if (user.role === 'ADMIN') return true
  const request = log.target.requestId ? db().requests.find((r) => r.id === log.target.requestId) : undefined
  if (user.role === 'DEPT_MANAGER') {
    if (request) return inDepartment(request, user.departmentId)
    const actor = db().users.find((u) => u.id === log.actor.id)
    return actor?.departmentId === user.departmentId
  }
  return request?.requester.id === user.id
}

function auditMatches(log: AuditLog, query: URLSearchParams): boolean {
  const actorId = query.get('actorId')
  const departmentId = query.get('departmentId')
  const projectId = query.get('projectId')
  const requestId = query.get('requestId')
  const action = query.get('action')
  const network = query.get('network')
  const from = query.get('from')
  const to = query.get('to')
  const database = db()
  const request = log.target.requestId ? database.requests.find((r) => r.id === log.target.requestId) : undefined
  if (actorId && log.actor.id !== actorId) return false
  if (departmentId && database.users.find((u) => u.id === log.actor.id)?.departmentId !== departmentId) return false
  if (projectId && (log.target.projectId ?? request?.projectId) !== projectId) return false
  if (requestId && log.target.requestId !== requestId) return false
  if (action && log.action !== action) return false
  if (network && log.network !== network) return false
  if (from && log.at < from) return false
  if (to && log.at > to) return false
  return true
}

/** 감사 로그 목록과 내보내기가 같은 기록을 고르도록 조건과 범위를 여기서만 적용한다. */
export function selectAuditLogs(user: StoredUser, query: URLSearchParams): AuditLog[] {
  return db().auditLogs.filter((log) => auditInScope(log, user) && auditMatches(log, query))
}
