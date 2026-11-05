/** 승인 기록 문서. 판 번호와 상태 규칙은 BeforeAi-BE의 ApprovalDocumentService와 같다. */
import { RULE_LABEL } from '../../lib/labels'
import { taskNumber } from '../../lib/taskLabel'
import type { ApprovalDocumentStatus, ApprovalDocumentVersion, ApproverRule, Plan, RequestStatus, Task, TaskStatus } from '../types'
import { PAGE_HEIGHT, PAGE_WIDTH, renderApprovalDocumentJpeg, type ApprovalDocumentContent, type DocumentBox } from './approvalDocumentImage'
import { buildImagePdf } from './imagePdf'
import { HttpError, db, nowIso, requireProject, signedApprovals, type StoredApproval, type StoredDocumentVersion, type StoredRequest } from './store'

/** 제출 뒤 요청자가 Plan을 고치는 중인 상태 */
const REVISING: RequestStatus[] = ['ANALYZING', 'ANALYSIS_FAILED', 'REVIEWING', 'REAPPROVAL_REQUIRED']
/** 하나라도 있으면 문서에 실행 결과를 담는 작업 상태 */
const EXECUTED: TaskStatus[] = ['RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'ROLLED_BACK']

/** 제출할 때 부른다. 같은 Plan을 다시 제출하면 내용이 같으므로 판을 늘리지 않는다. 에디터 변경과 문서 롤백은 대상이 아니다. */
export function recordSubmission(request: StoredRequest, at = nowIso()) {
  const { plan } = request
  if (!plan || request.source !== 'PROMPT' || plan.kind !== 'NORMAL') return
  const versions = (request.documentVersions ??= [])
  const latest = versions.at(-1)
  if (latest?.planId === plan.id) return
  versions.push({ version: (latest?.version ?? 0) + 1, planId: plan.id, createdAt: at })
}

function versionsOf(request: StoredRequest): StoredDocumentVersion[] {
  if (!request.documentVersions?.length) throw new HttpError(404, 'NOT_FOUND', '결재 문서를 찾을 수 없습니다')
  return request.documentVersions
}

/** 판의 Plan이 교체되지 않았으면 지금 값이 그 판의 내용이다. */
function contentOf(request: StoredRequest, entry: StoredDocumentVersion): { plan: Plan; approvals: StoredApproval[] } {
  return entry.retired ?? { plan: request.plan as Plan, approvals: signedApprovals(request, entry.planId) }
}

function isApproved(task: Task, approvals: StoredApproval[]): boolean {
  // 부분완료 뒤 고친 Plan에 그대로 옮겨 온 성공 작업은 다시 승인받지 않는다. 앞선 Plan에서 이미 승인받아 실행됐다.
  if (task.status === 'SUCCEEDED') return true
  return task.requiredApprovers.every(
    (requirement) => approvals.filter((item) => item.taskId === task.id && item.rule === requirement.rule).length >= requirement.count,
  )
}

function statusOf(request: StoredRequest, entry: StoredDocumentVersion, currentVersion: number): ApprovalDocumentStatus {
  if (entry.version !== currentVersion) return 'SUPERSEDED'
  if (request.status === 'REJECTED' || request.status === 'CANCELED' || request.status === 'KILLED') return request.status
  if (REVISING.includes(request.status)) return 'REVISING'
  // 웹쉘이 승인을 인정하지 않았다. 도장이 모두 있어도 승인 완료가 아니다.
  if (request.status === 'VERIFICATION_FAILED') return 'IN_PROGRESS'
  const { plan, approvals } = contentOf(request, entry)
  const approved = plan.tasks.filter((task) => task.risk !== 'FORBIDDEN').every((task) => isApproved(task, approvals))
  return approved ? 'APPROVED' : 'IN_PROGRESS'
}

const documentIdOf = (request: StoredRequest) => `doc-${request.id}`

/** 최신 판부터 준다. */
export function listDocumentVersions(request: StoredRequest): ApprovalDocumentVersion[] {
  const versions = versionsOf(request)
  const currentVersion = versions.at(-1)!.version
  return versions.toReversed().map((entry) => {
    const status = statusOf(request, entry, currentVersion)
    return {
      documentId: documentIdOf(request),
      version: entry.version,
      planId: entry.planId,
      planHash: contentOf(request, entry).plan.planHash as string,
      status,
      downloadable: status === 'APPROVED',
      createdAt: entry.createdAt,
    }
  })
}

/** 규칙마다 필요한 수만큼 칸을 두고 찍힌 순서대로 채운다. 어느 칸에도 안 맞는 승인도 기록이므로 칸을 늘려 남긴다. */
function toBoxes(task: Task, approvals: StoredApproval[]): DocumentBox[] {
  const signed = new Map<string, StoredApproval>()
  for (const approval of approvals) {
    if (approval.taskId === task.id && !signed.has(approval.userId)) signed.set(approval.userId, approval)
  }
  const unplaced = [...signed.values()]
  const toBox = (rule: string, approval: StoredApproval | undefined): DocumentBox => ({
    label: RULE_LABEL[rule as ApproverRule] ?? '승인',
    stamp: approval ? { name: approval.name, at: approval.at } : null,
  })
  const boxes = task.requiredApprovers.flatMap((requirement) =>
    Array.from({ length: requirement.count }, () => {
      const index = unplaced.findIndex((item) => item.rule === requirement.rule)
      return toBox(requirement.rule, index < 0 ? undefined : unplaced.splice(index, 1)[0])
    }),
  )
  return [...boxes, ...unplaced.map((item) => toBox(item.rule, item))]
}

function toContent(request: StoredRequest, entry: StoredDocumentVersion, currentVersion: number): ApprovalDocumentContent {
  const { plan, approvals } = contentOf(request, entry)
  const ran = plan.tasks.some((task) => EXECUTED.includes(task.status))
  return {
    requestId: request.id,
    version: entry.version,
    currentVersion,
    status: statusOf(request, entry, currentVersion),
    verificationFailed: request.status === 'VERIFICATION_FAILED' && entry.version === currentVersion,
    projectName: requireProject(request.projectId).name,
    requesterName: request.requester.name,
    requesterDepartment: db().departments.find((item) => item.id === request.requester.departmentId)?.name ?? null,
    submittedAt: entry.createdAt,
    prompt: request.prompt,
    repository: plan.repository,
    baseCommit: plan.baseCommit,
    planHash: plan.planHash,
    slots: plan.tasks.map((task) => ({
      number: taskNumber(task, plan.tasks),
      title: task.title,
      type: task.type,
      risk: task.risk,
      target: task.target,
      boxes: task.risk === 'FORBIDDEN' ? [] : toBoxes(task, approvals),
    })),
    results: ran ? plan.tasks.map((task) => ({ number: taskNumber(task, plan.tasks), title: task.title, status: task.status })) : [],
  }
}

function pdfResponse(request: StoredRequest, entry: StoredDocumentVersion, disposition: 'inline' | 'attachment', fileName: string): Response {
  const content = toContent(request, entry, versionsOf(request).at(-1)!.version)
  const pdf = buildImagePdf({
    jpeg: renderApprovalDocumentJpeg(content),
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    title: `승인 기록 문서 제 ${entry.version}판`,
  })
  return new Response(pdf, {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `${disposition}; filename="${fileName}"` },
  })
}

/** 최신 판 미리보기. 승인 진행 중에도 볼 수 있다. */
export function previewLatestDocument(request: StoredRequest): Response {
  return pdfResponse(request, versionsOf(request).at(-1)!, 'inline', `approval-document-${request.id}.pdf`)
}

/** 특정 판 미리보기. 이전 판도 기록으로 볼 수 있다. */
export function previewDocumentVersion(request: StoredRequest, version: string): Response {
  const entry = versionsOf(request).find((item) => String(item.version) === version)
  if (!entry) throw new HttpError(404, 'NOT_FOUND', '결재 문서 판을 찾을 수 없습니다')
  return pdfResponse(request, entry, 'inline', `approval-document-${request.id}-v${version}.pdf`)
}

/** 내려받기. 최신 판의 필요 승인이 모두 끝났을 때만 받을 수 있다. */
export function downloadDocument(request: StoredRequest): Response {
  const versions = versionsOf(request)
  const latest = versions.at(-1)!
  if (statusOf(request, latest, latest.version) !== 'APPROVED') {
    throw new HttpError(409, 'INVALID_STATE', '필요한 승인이 모두 끝난 결재 문서만 받을 수 있습니다')
  }
  return pdfResponse(request, latest, 'attachment', `approval-document-${request.id}.pdf`)
}
