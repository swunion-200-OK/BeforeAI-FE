/**
 * AI 분석 흉내. 실제 모델 대신 프롬프트의 낱말로 작업을 나눈다.
 * 시연용 키워드는 README의 "목 동작 트리거"에 정리해 두었다.
 */
import { makeUnifiedDiff } from '../../lib/diff'
import { explainTask } from '../../lib/explain'
import type { Plan, Project, Risk, Task, TaskContent, TaskType, UserRef } from '../types'
import { buildRequiredApprovers, findForbiddenReason } from './policy'
import { db, nextId } from './store'

const RISK_ORDER: Risk[] = ['LOW', 'MEDIUM', 'HIGH', 'FORBIDDEN']

interface Draft {
  type: TaskType
  title: string
  description: string
  target: string
  content: TaskContent
  relatedDepartments?: string[]
  raise?: { reason: string }
  previousBody?: string
}

export function defaultRisk(type: TaskType): Risk {
  return db().matrix.find((m) => m.taskType === type)?.defaultRisk ?? 'MEDIUM'
}

const SENSITIVE = /인증|토큰|비밀번호|세션|권한/

function fileOf(project: Project, path: string): string {
  return db().files[project.id]?.[path] ?? ''
}

function loginMessageDraft(project: Project): Draft {
  const path = 'src/auth/login.ts'
  const before = fileOf(project, path)
  const after = before.replace('Invalid credentials', '아이디 또는 비밀번호가 올바르지 않습니다')
  return {
    type: 'CODE_FEATURE',
    title: '로그인 실패 메시지 변경',
    description: '로그인 실패 시 보여 주는 에러 문구를 사용자가 이해하기 쉬운 한국어로 바꿉니다.',
    target: path,
    content: { diff: makeUnifiedDiff(path, before, after) },
  }
}

function genericCodeDraft(project: Project, type: TaskType, title: string, prompt: string): Draft {
  const path = type === 'CODE_MINOR' ? 'tests/login.test.ts' : 'src/index.ts'
  const before = fileOf(project, path)
  const after = `${before}\n// ${prompt.slice(0, 60)}\n`
  return {
    type,
    title,
    description: '요청 내용에 맞춰 코드를 수정합니다.',
    target: path,
    content: { diff: makeUnifiedDiff(path, before, after) },
  }
}

function buildDrafts(prompt: string, project: Project): Draft[] {
  const drafts: Draft[] = []
  const text = prompt

  if (/문서|README|가이드/i.test(text)) {
    const doc = db().documents.find((d) => d.projectId === project.id)
    const path = doc?.path ?? 'docs/README.md'
    const current = doc
      ? db().docVersions.find((v) => v.documentId === doc.id && v.version === doc.currentVersion)?.body ?? ''
      : ''
    drafts.push({
      type: 'DOC',
      title: `${path} 문서 수정`,
      description: 'AI가 문서를 끝까지 작성했습니다. 완성본을 보고 적용 여부를 정합니다.',
      target: path,
      content: { body: `${current}\n\n## 변경 내용\n\n${prompt}\n` },
      previousBody: current,
    })
  }
  if (/테스트|리팩터/.test(text)) {
    drafts.push(genericCodeDraft(project, 'CODE_MINOR', '테스트 코드 보강', prompt))
  }
  if (/로그인.*(메시지|문구)|(메시지|문구).*로그인/.test(text)) {
    drafts.push(loginMessageDraft(project))
  } else if (SENSITIVE.test(text)) {
    const path = 'src/auth/token.ts'
    const before = fileOf(project, path)
    drafts.push({
      type: 'CODE_FEATURE',
      title: '인증 로직 수정',
      description: '인증과 관련된 코드를 수정합니다.',
      target: path,
      content: { diff: makeUnifiedDiff(path, before, `${before}\n// ${prompt.slice(0, 60)}\n`) },
      raise: { reason: '인증 로직을 건드리는 변경입니다' },
    })
  } else if (/기능|버그|추가|에러|오류|수정해|고쳐|바꿔|변경/.test(text) && !/데이터|레코드|컬럼|스키마|마이그레이션|\bDB\b/i.test(text)) {
    drafts.push(genericCodeDraft(project, 'CODE_FEATURE', '기능 코드 수정', prompt))
  }
  if (/마이그레이션|스키마|컬럼|인덱스|\bDB\b/i.test(text)) {
    const prod = /운영|프로덕션|prod/i.test(text)
    drafts.push({
      type: 'DB',
      title: prod ? '운영 DB 스키마 변경' : '스테이징 DB 마이그레이션',
      description: '스키마를 변경합니다.',
      target: prod ? 'prod-db' : 'staging-db',
      content: { query: 'ALTER TABLE users ADD COLUMN last_login_at timestamptz;' },
    })
  }
  if (/조회|통계|뽑아/.test(text)) {
    drafts.push({
      type: 'DATA_READ',
      title: '운영 데이터 조회',
      description: '운영 데이터를 읽기 전용으로 조회합니다.',
      target: 'replica-db',
      content: { query: "SELECT count(*) FROM login_attempts WHERE created_at > now() - interval '7 days';" },
    })
  }
  if (/(데이터|레코드).*(수정|삭제|변경)|일괄/.test(text)) {
    drafts.push({
      type: 'DATA_WRITE',
      title: '운영 데이터 수정',
      description: '운영 데이터를 직접 수정합니다.',
      target: 'prod-db',
      content: { query: "UPDATE users SET status = 'dormant' WHERE last_login_at < now() - interval '1 year';" },
    })
  }
  if (/배포/.test(text)) {
    const target = /운영|프로덕션|production/i.test(text) ? 'production' : 'staging'
    drafts.push({
      type: 'DEPLOY',
      title: target === 'production' ? '운영 배포' : '스테이징 배포',
      description: `${target} 환경에 배포합니다.`,
      target,
      content: { command: `./deploy.sh ${target}` },
      relatedDepartments: [...new Set([project.departmentId, 'd-infra'])],
    })
  }
  if (drafts.length === 0) {
    drafts.push(genericCodeDraft(project, 'CODE_FEATURE', '요청 내용 반영', prompt))
  }
  return drafts
}

export function isAmbiguous(prompt: string): boolean {
  return prompt.trim().length < 6 || /알아서|적당히|대충/.test(prompt)
}

export const CLARIFICATION_QUESTION = '어떤 동작을 어떻게 바꾸면 될까요? 대상 기능과 바라는 결과를 알려 주세요.'

export function toTask(draft: Draft, order: number, project: Project, requester: UserRef): Task {
  const base = defaultRisk(draft.type)
  const relatedDepartments = draft.relatedDepartments ?? [project.departmentId]
  const forbiddenReason = findForbiddenReason(draft.type, draft.target, [project.departmentId, ...relatedDepartments], draft.content)
  let risk: Risk = base
  let riskRaised: Task['riskRaised']
  if (forbiddenReason) {
    risk = 'FORBIDDEN'
  } else if (draft.raise && RISK_ORDER.indexOf(base) < RISK_ORDER.indexOf('HIGH')) {
    risk = 'HIGH'
    riskRaised = { from: base, reason: draft.raise.reason }
  }
  return {
    id: `t-${order}`,
    order,
    type: draft.type,
    risk,
    title: draft.title,
    description: draft.description,
    target: draft.target,
    content: draft.content,
    relatedDepartments,
    requiredApprovers: buildRequiredApprovers(project, requester, draft.type, risk),
    status: forbiddenReason ? 'BLOCKED' : 'PENDING',
    explanation: explainTask({ ...draft, previousBody: draft.previousBody }),
    ...(riskRaised ? { riskRaised } : {}),
    ...(forbiddenReason ? { forbiddenReason } : {}),
  }
}

export function analyzePrompt(prompt: string, requestId: string, project: Project, requester: UserRef): Plan {
  const tasks = buildDrafts(prompt, project).map((draft, i) => toTask(draft, i + 1, project, requester))
  return makePlan(requestId, project, tasks)
}

export function makePlan(
  requestId: string,
  project: Project,
  tasks: Task[],
  kind: Plan['kind'] = 'NORMAL',
): Plan {
  return {
    id: nextId('p'),
    requestId,
    projectId: project.id,
    kind,
    repository: project.repository,
    baseCommit: project.baseCommit,
    planHash: null,
    tasks,
  }
}

/** 작업 수정 지시를 내용에 반영한다. 위험도는 올리기만 한다. */
export function applyInstruction(task: Task, instruction: string, project: Project, requester: UserRef): Task {
  const next: Task = {
    ...task,
    description: `${task.description ?? ''} 수정 지시: ${instruction}`.trim(),
    content: { ...task.content },
  }
  if (next.content.diff !== undefined) next.content.diff += `\n+// 수정 지시: ${instruction}`
  if (next.content.command !== undefined) next.content.command += ` # ${instruction}`
  if (next.content.query !== undefined) next.content.query += `\n-- ${instruction}`
  if (next.content.body !== undefined) next.content.body += `\n\n${instruction}\n`
  if (SENSITIVE.test(instruction) && (next.risk === 'LOW' || next.risk === 'MEDIUM')) {
    next.riskRaised = { from: next.risk, reason: '수정 지시가 인증 로직을 건드립니다' }
    next.risk = 'HIGH'
  }
  next.requiredApprovers = buildRequiredApprovers(project, requester, next.type, next.risk)
  // 수정 지시는 아래에 따로 적으므로 요약에는 원래 설명을 쓴다.
  const base = explainTask({ ...next, description: task.description })
  next.explanation = {
    ...base,
    summary: `${base.summary} 수정 지시도 반영했습니다.`,
    changes: [...base.changes, { where: '수정 지시', what: instruction }],
  }
  return next
}

export function editorTask(
  project: Project,
  requester: UserRef,
  description: string,
  files: Array<{ path: string; patch: string }>,
): Task {
  const target = files.length === 1 ? files[0].path : `${files[0].path} 외 ${files.length - 1}개`
  const sensitive = files.some((f) => /auth\/(session|token)/.test(f.path)) || SENSITIVE.test(description)
  return toTask(
    {
      type: 'CODE_FEATURE',
      title: description,
      description: '웹 코드 에디터에서 저장한 변경입니다.',
      target,
      content: { diff: files.map((f) => f.patch).join('\n') },
      ...(sensitive ? { raise: { reason: '인증 로직을 건드리는 변경입니다' } } : {}),
    },
    1,
    project,
    requester,
  )
}
