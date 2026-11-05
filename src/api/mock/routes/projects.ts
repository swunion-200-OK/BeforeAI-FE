import type { FileEntry, ForbiddenRule, Project, ProjectSpec, SpecChangeRequest } from '../../types'
import { assertAdminProof, nextPolicyVersion } from '../policy'
import { createRequest, reapproveAfterOwnerChange } from '../engine'
import { paginate, route, type Route } from '../router'
import {
  HttpError,
  audit,
  db,
  nextId,
  notify,
  nowIso,
  requireProject,
  requireUser,
  type StoredProject,
  type StoredUser,
} from '../store'

const MIN_OWNERS = 2

function latestSpec(projectId: string): ProjectSpec {
  const versions = db().specs[projectId]
  if (!versions?.length) throw new HttpError(404, 'NOT_FOUND', '기획서를 찾을 수 없습니다')
  return versions[versions.length - 1]
}

function saveSpec(projectId: string, body: string, user: StoredUser, restoredFromVersion: number | null = null, reason?: string): ProjectSpec {
  const versions = (db().specs[projectId] ??= [])
  const spec: ProjectSpec = {
    projectId,
    version: versions.length + 1,
    body,
    createdAt: nowIso(),
    createdBy: user.id,
    restoredFromVersion,
  }
  versions.push(spec)
  audit(user, 'SPEC_UPDATED', { projectId, label: `기획서 v${spec.version}` }, reason ? { reason } : {})
  return spec
}

function assertSpecEditor(user: StoredUser, project: Project) {
  if (user.role === 'ADMIN') return
  if (user.role === 'DEPT_MANAGER' && user.departmentId === project.departmentId) return
  throw new HttpError(403, 'FORBIDDEN_ROLE', '담당 부서 팀장과 관리자만 할 수 있습니다')
}

function requireChangeRequest(id: string): SpecChangeRequest {
  const found = db().changeRequests.find((c) => c.id === id)
  if (!found) throw new HttpError(404, 'NOT_FOUND', '수정 요청을 찾을 수 없습니다')
  return found
}

function ownerRefs(ids: string[]) {
  return ids.map((id) => {
    const { id: userId, name } = requireUser(id)
    return { id: userId, name }
  })
}

/** 기준 커밋은 목 내부 값이다. 서버처럼 파일 목록으로만 알려 준다. */
function projectView({ baseCommit: _baseCommit, ...project }: StoredProject): Project {
  return project
}

function requireProposal(id: string) {
  const found = db().proposals.find((p) => p.id === id)
  if (!found) throw new HttpError(404, 'NOT_FOUND', '제안을 찾을 수 없습니다')
  return found
}

function activateRule(input: Pick<ForbiddenRule, 'departmentId' | 'taskType' | 'target' | 'reason'>): ForbiddenRule {
  const database = db()
  const rule: ForbiddenRule = {
    id: nextId('rule'),
    departmentId: input.departmentId,
    taskType: input.taskType,
    target: input.target,
    reason: input.reason,
    status: 'CONFIRMED',
  }
  database.forbiddenRules.unshift(rule)
  // 규칙 추가는 웹쉘 정책에도 바로 반영된다 (5.7).
  database.webshell.policy.forbiddenRules.push({
    departmentId: rule.departmentId,
    taskType: rule.taskType,
    target: rule.target,
  })
  return rule
}

export const projectRoutes: Route[] = [
  // ── 프로젝트·기획서 ─────────────────────────────────────
  route('GET', '/projects', () => ({ items: db().projects.map(projectView), nextCursor: null })),
  route('GET', '/projects/:projectId', ({ params }) => projectView(requireProject(params.projectId))),
  route(
    'POST',
    '/admin/projects',
    ({ me, body }) => {
      const ownerIds: string[] = body.ownerIds ?? []
      if (ownerIds.length < MIN_OWNERS) throw new HttpError(409, 'OWNER_MINIMUM', '담당자는 2명 이상이어야 합니다')
      if (!body.name?.trim() || !body.repository?.trim()) {
        throw new HttpError(400, 'VALIDATION_ERROR', '프로젝트 이름과 저장소를 입력해 주세요')
      }
      const database = db()
      const project: StoredProject = {
        id: nextId('prj'),
        name: body.name.trim(),
        departmentId: body.departmentId,
        repository: body.repository.trim(),
        baseCommit: '0000000',
        owners: ownerRefs(ownerIds),
      }
      database.projects.push(project)
      database.files[project.id] = { 'README.md': `# ${project.name}\n` }
      saveSpec(project.id, body.initialSpec?.body ?? '', me)
      return projectView(project)
    },
    { internal: true, roles: ['ADMIN'] },
  ),
  route('GET', '/projects/:projectId/spec', ({ params }) => latestSpec(params.projectId)),
  route(
    'PUT',
    '/projects/:projectId/spec',
    ({ me, params, body }) => {
      assertSpecEditor(me, requireProject(params.projectId))
      return saveSpec(params.projectId, body.body, me)
    },
    { internal: true },
  ),
  route('GET', '/projects/:projectId/spec/versions', ({ params, query }) =>
    paginate([...(db().specs[params.projectId] ?? [])].reverse(), query),
  ),
  route(
    'POST',
    '/projects/:projectId/spec/versions/:version/restore',
    ({ me, params, body }) => {
      assertSpecEditor(me, requireProject(params.projectId))
      const target = db().specs[params.projectId]?.find((v) => v.version === Number(params.version))
      if (!target) throw new HttpError(404, 'NOT_FOUND', '해당 버전이 없습니다')
      return saveSpec(params.projectId, target.body, me, target.version, body?.reason)
    },
    { internal: true },
  ),
  route(
    'PUT',
    '/projects/:projectId/owners',
    ({ me, params, body }) => {
      const project = requireProject(params.projectId)
      assertSpecEditor(me, project)
      const ownerIds: string[] = body.ownerIds ?? []
      // 비활성 계정은 승인할 수 없으므로 담당자 수에 넣지 않는다.
      const activeOwners = new Set(ownerIds.filter((id) => requireUser(id).active))
      if (activeOwners.size < MIN_OWNERS) {
        throw new HttpError(409, 'OWNER_MINIMUM', '담당자는 2명 이상이어야 합니다')
      }
      const removed = project.owners.map((o) => o.id).filter((id) => !ownerIds.includes(id))
      project.owners = ownerRefs(ownerIds)
      audit(me, 'SPEC_UPDATED', { projectId: project.id, label: '담당자 변경' }, { ownerIds })
      reapproveAfterOwnerChange(project.id, removed, me.name)
      notify(
        db()
          .users.filter((u) => u.role === 'ADMIN')
          .map((u) => u.id),
        `${project.name} 담당자가 바뀌었습니다`,
        `/projects/${project.id}`,
      )
      return projectView(project)
    },
    { internal: true },
  ),
  route(
    'POST',
    '/projects/:projectId/spec/change-requests',
    ({ me, params, body }) => {
      const project = requireProject(params.projectId)
      if (!body.content?.trim() || !body.reason?.trim()) {
        throw new HttpError(400, 'VALIDATION_ERROR', '변경 내용과 사유를 입력해 주세요')
      }
      const request: SpecChangeRequest = {
        id: nextId('cr'),
        projectId: project.id,
        content: body.content,
        reason: body.reason,
        requesterId: me.id,
        status: 'OPEN',
        rejectionReason: null,
        createdAt: nowIso(),
      }
      db().changeRequests.unshift(request)
      audit(me, 'SPEC_UPDATED', { projectId: project.id, label: '기획서 수정 요청' })
      notify(
        db()
          .users.filter((u) => u.role === 'DEPT_MANAGER' && u.departmentId === project.departmentId)
          .map((u) => u.id),
        `기획서 수정 요청이 도착했습니다: ${project.name}`,
        `/projects/${project.id}`,
      )
      return request
    },
    { internal: true },
  ),
  route(
    'GET',
    '/projects/:projectId/spec/change-requests',
    ({ params, query }) => {
      const status = query.get('status')
      return paginate(
        db().changeRequests.filter((c) => c.projectId === params.projectId && (!status || c.status === status)),
        query,
      )
    },
    { internal: true },
  ),
  route(
    'POST',
    '/projects/:projectId/spec/change-requests/:crId/accept',
    ({ me, params }) => {
      assertSpecEditor(me, requireProject(params.projectId))
      const request = requireChangeRequest(params.crId)
      if (request.status !== 'OPEN') throw new HttpError(409, 'INVALID_STATE', '이미 처리한 요청입니다')
      const spec = saveSpec(params.projectId, `${latestSpec(params.projectId).body}\n\n${request.content}`, me)
      request.status = 'ACCEPTED'
      return { changeRequest: request, spec }
    },
    { internal: true },
  ),
  route(
    'POST',
    '/projects/:projectId/spec/change-requests/:crId/reject',
    ({ me, params, body }) => {
      assertSpecEditor(me, requireProject(params.projectId))
      if (!body.reason?.trim()) throw new HttpError(400, 'VALIDATION_ERROR', '반려 사유를 입력해 주세요')
      const request = requireChangeRequest(params.crId)
      if (request.status !== 'OPEN') throw new HttpError(409, 'INVALID_STATE', '이미 처리한 요청입니다')
      request.status = 'REJECTED'
      request.rejectionReason = body.reason
      audit(me, 'SPEC_UPDATED', { projectId: params.projectId, label: '기획서 수정 요청 반려' }, { reason: body.reason })
      return request
    },
    { internal: true },
  ),

  // ── 금지 작업 ───────────────────────────────────────────
  route('GET', '/departments/:deptId/forbidden-rules', ({ params, query }) =>
    paginate(
      db().forbiddenRules.filter((r) => r.departmentId === params.deptId),
      query,
    ),
  ),
  route(
    'POST',
    '/departments/:deptId/forbidden-proposals',
    ({ me, params, body }) => {
      if (me.role !== 'DEPT_MANAGER' || me.departmentId !== params.deptId) {
        throw new HttpError(403, 'FORBIDDEN_ROLE', '소속 부서 팀장만 제안할 수 있습니다')
      }
      if (!body.target?.trim() || !body.reason?.trim()) {
        throw new HttpError(400, 'VALIDATION_ERROR', '대상과 사유를 입력해 주세요')
      }
      const proposal = {
        id: nextId('fp'),
        departmentId: params.deptId,
        taskType: body.taskType,
        target: body.target.trim(),
        reason: body.reason.trim(),
        status: 'OPEN' as const,
      }
      db().proposals.unshift(proposal)
      audit(me, 'FORBIDDEN_RULE_PROPOSED', { label: `${proposal.taskType} ${proposal.target}` })
      return proposal
    },
    { internal: true, status: 201 },
  ),
  route(
    'GET',
    '/admin/forbidden-proposals',
    ({ query }) => {
      const status = query.get('status')
      return paginate(
        db().proposals.filter((p) => !status || p.status === status),
        query,
      )
    },
    { internal: true, roles: ['ADMIN'] },
  ),
  route(
    'POST',
    '/admin/forbidden-proposals/:proposalId/confirm',
    ({ me, params, body }) => {
      assertAdminProof(body?.adminProof)
      const proposal = requireProposal(params.proposalId)
      if (proposal.status !== 'OPEN') throw new HttpError(409, 'INVALID_STATE', '이미 처리한 제안입니다')
      proposal.status = 'CONFIRMED'
      const rule = activateRule(proposal)
      audit(me, 'FORBIDDEN_RULE_CONFIRMED', { label: `${proposal.taskType} ${proposal.target}` })
      return { proposalId: proposal.id, status: proposal.status, rule, policyVersion: nextPolicyVersion() }
    },
    { internal: true, roles: ['ADMIN'] },
  ),
  route(
    'POST',
    '/admin/forbidden-proposals/:proposalId/reject',
    ({ me, params, body }) => {
      if (!body.reason?.trim()) throw new HttpError(400, 'VALIDATION_ERROR', '반려 사유를 입력해 주세요')
      const proposal = requireProposal(params.proposalId)
      if (proposal.status !== 'OPEN') throw new HttpError(409, 'INVALID_STATE', '이미 처리한 제안입니다')
      proposal.status = 'REJECTED'
      audit(me, 'FORBIDDEN_RULE_REJECTED', { label: `${proposal.taskType} ${proposal.target}` }, { reason: body.reason })
      return { proposalId: proposal.id, status: proposal.status }
    },
    { internal: true, roles: ['ADMIN'] },
  ),
  route(
    'POST',
    '/admin/forbidden-rules',
    ({ me, body }) => {
      assertAdminProof(body.adminProof)
      if (!body.target?.trim() || !body.reason?.trim()) {
        throw new HttpError(400, 'VALIDATION_ERROR', '대상과 사유를 입력해 주세요')
      }
      const rule = activateRule(body)
      nextPolicyVersion()
      audit(me, 'FORBIDDEN_RULE_CONFIRMED', { label: `${rule.taskType} ${rule.target}` }, { direct: true })
      return rule
    },
    { internal: true, roles: ['ADMIN'], status: 201 },
  ),
  route(
    'POST',
    '/admin/forbidden-rules/:ruleId/release',
    ({ me, params, body }) => {
      if (!body?.reason?.trim()) throw new HttpError(400, 'VALIDATION_ERROR', '해제 사유를 입력해 주세요')
      // 서명은 없어도 된다. 있으면 서버가 새 정책 버전을 바로 만들어 웹쉘에 보낸다.
      if (body.adminProof) assertAdminProof(body.adminProof)
      const rule = db().forbiddenRules.find((r) => r.id === params.ruleId)
      if (!rule) throw new HttpError(404, 'NOT_FOUND', '규칙을 찾을 수 없습니다')
      if (rule.status !== 'CONFIRMED') throw new HttpError(409, 'INVALID_STATE', '이미 해제를 요청한 규칙입니다')
      rule.status = 'RELEASE_PENDING'
      if (body.adminProof) nextPolicyVersion()
      audit(me, 'FORBIDDEN_RULE_RELEASE_REQUESTED', { label: `${rule.taskType} ${rule.target}` }, { reason: body.reason })
      return { ruleId: rule.id, status: rule.status }
    },
    { internal: true, roles: ['ADMIN'] },
  ),

  // ── 문서 ────────────────────────────────────────────────
  route('GET', '/projects/:projectId/documents', ({ params, query }) =>
    paginate(
      db().documents.filter((d) => d.projectId === params.projectId),
      query,
    ),
  ),
  route('GET', '/documents/:documentId/versions', ({ params, query }) => {
    const versions = db()
      .docVersions.filter((v) => v.documentId === params.documentId)
      .sort((a, b) => b.version - a.version)
      .map(({ body: _body, ...summary }) => summary)
    return paginate(versions, query)
  }),
  route('GET', '/documents/:documentId/versions/:version', ({ params }) => {
    const found = db().docVersions.find(
      (v) => v.documentId === params.documentId && v.version === Number(params.version),
    )
    if (!found) throw new HttpError(404, 'NOT_FOUND', '해당 버전이 없습니다')
    // 서버처럼 상세에는 적용 요청과 작성자를 싣지 않는다. 화면은 목록의 값을 쓴다.
    const { requestId: _requestId, createdBy: _createdBy, ...version } = found
    return version
  }),

  // ── 웹 코드 에디터 ──────────────────────────────────────
  route(
    'GET',
    '/projects/:projectId/files',
    ({ params, query }) => {
      const project = requireProject(params.projectId)
      const dir = (query.get('path') ?? '').replace(/\/$/, '')
      const files = Object.keys(db().files[project.id] ?? {})
      const entries = new Map<string, FileEntry>()
      for (const file of files) {
        if (dir && !file.startsWith(`${dir}/`)) continue
        const rest = dir ? file.slice(dir.length + 1) : file
        const [head, ...tail] = rest.split('/')
        const path = dir ? `${dir}/${head}` : head
        entries.set(path, { name: head, path, type: tail.length ? 'DIR' : 'FILE' })
      }
      return {
        path: dir,
        baseCommit: project.baseCommit,
        items: [...entries.values()].sort(
          (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name),
        ),
      }
    },
    { internal: true },
  ),
  route(
    'GET',
    '/projects/:projectId/files/content',
    ({ params, query }) => {
      const project = requireProject(params.projectId)
      const path = query.get('path') ?? ''
      const content = db().files[project.id]?.[path]
      if (content === undefined) throw new HttpError(404, 'NOT_FOUND', '파일을 찾을 수 없습니다')
      return { path, ref: query.get('ref') ?? project.baseCommit, baseCommit: project.baseCommit, content }
    },
    { internal: true },
  ),
  route(
    'POST',
    '/projects/:projectId/editor/changes',
    ({ me, params, body }) => {
      const project = requireProject(params.projectId)
      if (body.baseCommit !== project.baseCommit || body.description?.includes('#충돌')) {
        throw new HttpError(409, 'EDIT_CONFLICT', '에디터를 연 뒤 저장소가 바뀌었습니다')
      }
      if (!body.files?.length) throw new HttpError(400, 'VALIDATION_ERROR', '바뀐 파일이 없습니다')
      if (!body.description?.trim()) throw new HttpError(400, 'VALIDATION_ERROR', '변경 설명을 입력해 주세요')
      const request = createRequest(me, project.id, body.description, 'EDITOR', {
        kind: 'EDITOR',
        description: body.description,
        files: body.files,
      })
      return { requestId: request.id, source: 'EDITOR', status: request.status }
    },
    { internal: true },
  ),
]
