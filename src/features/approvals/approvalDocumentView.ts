import { ApiError } from '../../api/errors'
import type { ApprovalDocumentStatus, ApprovalDocumentVersion, RequestStatus } from '../../api/types'
import { APPROVAL_DOCUMENT_STATUS_LABEL } from '../../lib/labels'

const DOWNLOAD_BLOCKED: Record<ApprovalDocumentStatus, string> = {
  IN_PROGRESS: '승인이 끝나면 내려받을 수 있습니다',
  APPROVED: '지금은 내려받을 수 없습니다',
  REVISING: 'Plan을 고치는 중이라 내려받을 수 없습니다',
  SUPERSEDED: '이전 판은 보기만 할 수 있습니다',
  REJECTED: '거부된 요청은 내려받을 수 없습니다',
  CANCELED: '취소된 요청은 내려받을 수 없습니다',
  KILLED: '중단된 요청은 내려받을 수 없습니다',
}

/**
 * 제출 전이나 대상이 아닌 요청의 404와 서버에 아직 없는 경로의 404는 구분되지 않는다.
 * 어느 쪽이든 "아직 문서가 없다"는 말은 사실이므로 같은 안내로 답한다. 405는 whenOnServer와 같이 없는 경로로 본다.
 */
export function isNoDocument(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 405)
}

/** 승인 화면의 무결성 확인에 실패했으면 서버가 만든 문서를 보여 주지 않는다. 문서의 내용과 해시를 믿을 수 없다. */
export function documentHiddenReason(integrityFailed: boolean | undefined): string | null {
  return integrityFailed ? '무결성 확인에 실패해 문서를 표시하지 않습니다' : null
}

/** 무결성 확인을 거쳤는지 모르는 화면(undefined)에서는 그렇다고 함께 말한다. */
export function documentNote(integrityFailed: boolean | undefined): string {
  const copy = '서버가 만든 승인 기록 문서입니다. 승인 서명은 이 문서가 아니라 Plan 해시에 합니다.'
  return integrityFailed === undefined ? `${copy} 무결성 확인을 거치지 않았습니다.` : copy
}

/** 서버가 승인 완료라고 답해도 믿지 않는다. 웹쉘이 승인을 인정하지 않은 요청이다. */
export function documentWarning(requestStatus: RequestStatus): string | null {
  return requestStatus === 'VERIFICATION_FAILED' ? '웹쉘 검증에 실패한 요청입니다. 문서의 승인 표시와 도장을 믿지 마세요.' : null
}

/** 내려받을 수 있으면 null. */
export function downloadBlockedReason(version: ApprovalDocumentVersion, requestStatus: RequestStatus): string | null {
  if (requestStatus === 'VERIFICATION_FAILED') return '웹쉘 검증에 실패해 내려받을 수 없습니다'
  if (version.downloadable) return null
  return DOWNLOAD_BLOCKED[version.status] ?? '지금은 내려받을 수 없습니다'
}

export function versionLabel(version: ApprovalDocumentVersion, requestStatus: RequestStatus): string {
  const status =
    requestStatus === 'VERIFICATION_FAILED' && version.status === 'APPROVED'
      ? '웹쉘 검증 실패'
      : (APPROVAL_DOCUMENT_STATUS_LABEL[version.status] ?? version.status)
  return `제 ${version.version}판 · ${status}`
}

/** 값이 없는 브라우저는 알 수 없으니 일단 보여 준다. */
export function canShowPdf(browser: Pick<Navigator, 'pdfViewerEnabled'> | undefined = globalThis.navigator): boolean {
  return browser?.pdfViewerEnabled !== false
}

/** PDF를 그리지 못하는 브라우저의 안내. 내려받을 수 없는 판이면 그 이유를 잇는다. 미리보기를 저장하는 우회 경로는 두지 않는다. */
export function pdfViewerNotice(blockedReason: string | null): string {
  return `이 브라우저에서는 PDF를 바로 볼 수 없습니다. ${blockedReason ? `${blockedReason}.` : 'PDF 내려받기로 확인해 주세요.'}`
}
