import type { ErrorCode } from './types'

/** 오류 코드 → 사용자 메시지. 서버가 준 message보다 이 표를 우선한다. */
export const ERROR_MESSAGES: Partial<Record<ErrorCode, string>> = {
  UNAUTHENTICATED: '다시 로그인해 주세요',
  OTP_REQUIRED: 'OTP 인증이 필요합니다',
  FORBIDDEN_ROLE: '권한이 없습니다',
  INTERNAL_NETWORK_ONLY: '내부망에서만 가능한 기능입니다',
  NOT_APPROVER: '이 작업의 승인권자가 아닙니다',
  KEY_NOT_REGISTERED: '승인 키가 아직 등록되지 않았습니다 (관리자 등록 필요)',
  INVALID_STATE: '지금 상태에서는 할 수 없는 동작입니다',
  PLAN_HASH_MISMATCH: 'Plan이 바뀌었습니다. 새로고침 후 다시 확인해 주세요',
  EDIT_CONFLICT: '에디터를 연 뒤 저장소가 바뀌었습니다',
  OWNER_MINIMUM: '담당자는 2명 이상이어야 합니다',
  RETRY_LIMIT: '분석 재시도 횟수(3회)를 넘었습니다',
  FORBIDDEN_TASK: '금지 작업이 포함되어 있습니다',
  WEBSHELL_UNAVAILABLE: '웹쉘에 연결할 수 없습니다',
  EXPORT_TOO_LARGE: '내보낼 기록이 100,000건을 넘습니다. 기간을 줄여 다시 시도해 주세요',
}

export class ApiError extends Error {
  readonly status: number
  readonly code: ErrorCode | string
  readonly details: Record<string, unknown>
  /** 서버가 보낸 문구 그대로. 코드 하나에 사유가 여럿일 때(로그인 실패 등) 화면이 표 대신 이 문구를 쓴다. */
  readonly serverMessage: string

  constructor(status: number, code: ErrorCode | string, message: string, details: Record<string, unknown> = {}) {
    super(ERROR_MESSAGES[code as ErrorCode] ?? message)
    this.name = 'ApiError'
    this.serverMessage = message
    this.status = status
    this.code = code
    this.details = details
  }
}

export const INTERNAL_ONLY_MESSAGE = ERROR_MESSAGES.INTERNAL_NETWORK_ONLY as string

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '요청을 처리하지 못했습니다'
}
