import { describe, expect, it } from 'vitest'
import { ApiError } from '../../api/errors'
import type { ApprovalDocumentStatus, ApprovalDocumentVersion } from '../../api/types'
import {
  canShowPdf,
  documentHiddenReason,
  documentNote,
  documentWarning,
  downloadBlockedReason,
  isNoDocument,
  pdfViewerNotice,
  versionLabel,
} from './approvalDocumentView'

const version = (status: ApprovalDocumentStatus): ApprovalDocumentVersion => ({
  documentId: 'd',
  version: 2,
  planId: 'p',
  planHash: 'sha256:1',
  status,
  downloadable: status === 'APPROVED',
  createdAt: '2026-11-05T00:00:00Z',
})

describe('isNoDocument', () => {
  it('404와 405만 문서 없음으로 읽는다', () => {
    expect(isNoDocument(new ApiError(404, 'NOT_FOUND', '없음'))).toBe(true)
    expect(isNoDocument(new ApiError(404, 'UNKNOWN', '프록시가 준 404'))).toBe(true)
    expect(isNoDocument(new ApiError(405, 'UNKNOWN', '없는 메서드'))).toBe(true)
    expect(isNoDocument(new ApiError(0, 'NETWORK_ERROR', '연결 실패'))).toBe(false)
    expect(isNoDocument(new ApiError(403, 'FORBIDDEN_ROLE', '권한 없음'))).toBe(false)
    expect(isNoDocument(new ApiError(500, 'UNKNOWN', '서버 오류'))).toBe(false)
    expect(isNoDocument(new Error('다른 오류'))).toBe(false)
  })
})

describe('downloadBlockedReason', () => {
  it('내려받을 수 있으면 이유가 없다', () => {
    expect(downloadBlockedReason(version('APPROVED'), 'COMPLETED')).toBeNull()
  })

  it.each<ApprovalDocumentStatus>(['IN_PROGRESS', 'REVISING', 'SUPERSEDED', 'REJECTED', 'CANCELED', 'KILLED'])('%s이면 이유를 말한다', (status) => {
    expect(downloadBlockedReason(version(status), 'PENDING_APPROVAL')).toMatch(/내려받을|보기만/)
  })

  it('처음 보는 상태여도 문구를 낸다', () => {
    expect(downloadBlockedReason(version('NEW' as ApprovalDocumentStatus), 'PENDING_APPROVAL')).toBe('지금은 내려받을 수 없습니다')
  })

  it('웹쉘 검증에 실패한 요청은 서버가 승인 완료라고 해도 막는다', () => {
    expect(downloadBlockedReason(version('APPROVED'), 'VERIFICATION_FAILED')).toBe('웹쉘 검증에 실패해 내려받을 수 없습니다')
  })
})

describe('versionLabel', () => {
  it('판 번호와 상태를 적는다', () => {
    expect(versionLabel(version('SUPERSEDED'), 'COMPLETED')).toBe('제 2판 · 이전 판')
    expect(versionLabel(version('APPROVED'), 'COMPLETED')).toBe('제 2판 · 승인 완료')
  })

  it('웹쉘 검증에 실패했으면 서버 값이어도 승인 완료라고 쓰지 않는다', () => {
    expect(versionLabel(version('APPROVED'), 'VERIFICATION_FAILED')).toBe('제 2판 · 웹쉘 검증 실패')
  })
})

describe('문서 표시 판정', () => {
  it('무결성 확인에 실패하면 문서를 표시하지 않는다', () => {
    expect(documentHiddenReason(true)).toBe('무결성 확인에 실패해 문서를 표시하지 않습니다')
    expect(documentHiddenReason(false)).toBeNull()
    expect(documentHiddenReason(undefined)).toBeNull()
  })

  it('확인을 거치지 않은 화면에서는 서버가 만든 사본이고 확인하지 않았다고 말한다', () => {
    expect(documentNote(undefined)).toContain('서버가 만든')
    expect(documentNote(undefined)).toContain('무결성 확인을 거치지 않았습니다')
    expect(documentNote(false)).toContain('서버가 만든')
    expect(documentNote(false)).not.toContain('거치지 않았습니다')
  })

  it('웹쉘 검증 실패에만 경고한다', () => {
    expect(documentWarning('VERIFICATION_FAILED')).toContain('믿지 마세요')
    expect(documentWarning('COMPLETED')).toBeNull()
  })
})

describe('PDF 보기 지원', () => {
  it('false일 때만 못 보여 준다고 판단한다', () => {
    expect(canShowPdf({ pdfViewerEnabled: false })).toBe(false)
    expect(canShowPdf({ pdfViewerEnabled: true })).toBe(true)
    expect(canShowPdf({} as Navigator)).toBe(true)
  })

  it('내려받을 수 있으면 내려받기로 안내하고, 없으면 그 이유를 잇는다', () => {
    expect(pdfViewerNotice(null)).toContain('PDF 내려받기로 확인해 주세요')
    expect(pdfViewerNotice('승인이 끝나면 내려받을 수 있습니다')).toContain('승인이 끝나면 내려받을 수 있습니다.')
  })
})
