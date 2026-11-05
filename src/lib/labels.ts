import type {
  ApprovalDocumentStatus,
  ApproverRule,
  AuditAction,
  ExportFormat,
  ExportStatus,
  FailedCheck,
  Network,
  PolicyPreset,
  RequestSource,
  RequestStatus,
  Risk,
  Role,
  Task,
  TaskStatus,
  TaskType,
} from '../api/types'
import { josa } from './josa'

/** 서버가 표에 없는 새 값을 보내면 빈칸 대신 그 값을 그대로 보여 준다. */
export function labelOf<T extends string>(table: Record<T, string>, value: T): string {
  return table[value] ?? value
}

export const RISK_LABEL: Record<Risk, string> = { LOW: '낮음', MEDIUM: '중간', HIGH: '높음', FORBIDDEN: '금지' }

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  DOC: '문서',
  CODE_MINOR: '코드 수정(경미)',
  CODE_FEATURE: '코드 수정(기능)',
  DATA_READ: '데이터 조회',
  DATA_WRITE: '데이터 수정',
  DB: 'DB 접근',
  DEPLOY: '배포',
}
export const TASK_TYPES = Object.keys(TASK_TYPE_LABEL) as TaskType[]

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  ANALYZING: '분석중',
  ANALYSIS_FAILED: '분석실패',
  REVIEWING: '검토중',
  PENDING_APPROVAL: '승인대기',
  REAPPROVAL_REQUIRED: '재승인필요',
  VERIFICATION_FAILED: '검증실패',
  REJECTED: '거부',
  CANCELED: '취소',
  RUNNING: '실행중',
  KILLED: '중단',
  COMPLETED: '완료',
  PARTIALLY_COMPLETED: '부분완료',
  FAILED: '실패',
  ROLLING_BACK: '롤백중',
  ROLLED_BACK: '롤백됨',
  ROLLBACK_FAILED: '롤백실패',
}
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  PENDING: '승인 대기',
  APPROVED: '승인됨',
  REJECTED: '거부됨',
  BLOCKED: '금지',
  RUNNING: '실행 중',
  SUCCEEDED: '성공',
  FAILED: '실패',
  SKIPPED: '실행 안 됨',
  ROLLED_BACK: '롤백됨',
}

/** 금지 사유. 서버 작업에는 사유가 없어(TaskResponse), 서버가 FORBIDDEN으로 정하는 기준인 부서 금지 규칙에 걸렸다는 사실만 쓴다. */
export function forbiddenReasonText(task: Pick<Task, 'type' | 'target' | 'forbiddenReason'>): string {
  return task.forbiddenReason ?? `${labelOf(TASK_TYPE_LABEL, task.type)} 대상 ${josa(task.target, '이', '가')} 부서 금지 규칙에 걸렸습니다.`
}

/** 금지 작업이 섞인 요청이 끝났을 때 함께 쓰는 말. 끝났다는 말만 있으면 금지 작업도 실행된 것처럼 보인다. */
export function forbiddenExcludedText(count: number): string {
  return `금지 작업 ${count}개는 실행하지 않았습니다`
}

export const ROLE_LABEL: Record<Role, string> = { ADMIN: '관리자', DEPT_MANAGER: '부서 관리자', EMPLOYEE: '직원' }
export const NETWORK_LABEL: Record<Network, string> = { INTERNAL: '내부망', EXTERNAL: '외부망' }
export const SOURCE_LABEL: Record<RequestSource, string> = {
  PROMPT: '프롬프트',
  EDITOR: '웹 코드 에디터',
  ROLLBACK: '문서 롤백',
}

export const RULE_LABEL: Record<ApproverRule, string> = {
  ANYONE: '누구나',
  SAME_DEPT_OTHER: '같은 부서 동료',
  PROJECT_OWNER: '프로젝트 담당자',
  DEPT_MANAGER: '부서 관리자',
  ADMIN: '관리자',
}

export const PRESET_LABEL: Record<PolicyPreset, string> = { SMALL: '소규모', MEDIUM: '중규모', LARGE: '대규모' }

export const FAILED_CHECK_LABEL: Record<FailedCheck, string> = {
  DECRYPT_FAILED: '승인 서명을 복호화할 수 없음 (중간 변조 또는 다른 키로 암호화)',
  PLAN_HASH_MISMATCH: '직접 계산한 해시가 서명의 해시와 다름 (Plan이 바뀜)',
  SIGNATURE_INVALID: '서명이 공개키로 검증되지 않음',
  KEY_NOT_REGISTERED: '웹쉘 정책에 없거나 폐기된 키',
  NONCE_ALREADY_USED: '이미 실행에 쓴 서명',
  MISSING_REQUIRED_APPROVER: '필요한 승인권자(예: 담당자)의 서명이 없음',
  FORBIDDEN_TASK: '웹쉘 정책의 금지 작업이 포함됨',
}

export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  REQUEST_CREATED: '요청 생성',
  PLAN_UPDATED: 'Plan 수정',
  SUBMITTED: '제출',
  APPROVAL_SUBMITTED: '승인 서명 제출',
  REJECTED: '거부',
  REQUEST_CANCELED: '요청 취소',
  EXECUTION_STARTED: '실행 시작',
  VERIFICATION_FAILED: '검증 실패',
  TASK_SUCCEEDED: '작업 성공',
  TASK_FAILED: '작업 실패',
  KILLED: '킬 스위치',
  ROLLBACK_REQUESTED: '문서 롤백 요청',
  ROLLBACK_SUCCEEDED: '문서 롤백 성공',
  ROLLBACK_FAILED: '문서 롤백 실패',
  SPEC_UPDATED: '기획서 변경',
  FORBIDDEN_RULE_PROPOSED: '금지 작업 제안',
  FORBIDDEN_RULE_CONFIRMED: '금지 작업 확정',
  FORBIDDEN_RULE_REJECTED: '금지 작업 반려',
  FORBIDDEN_RULE_RELEASE_REQUESTED: '금지 작업 해제 요청',
  KEY_SUBMITTED: '승인 키 제출',
  KEY_REGISTERED: '승인 키 등록',
  KEY_REVOKED: '승인 키 폐기',
  LOGIN: '로그인',
  ACCOUNT_CHANGED: '계정 변경',
  POLICY_CHANGED: '정책 변경',
  AUDIT_EXPORTED: '감사 로그 내보내기',
}

/** 감사 로그 detail 항목의 이름. 상세 화면과 내보낸 파일이 함께 쓴다. */
export const AUDIT_DETAIL_LABEL: Record<string, string> = {
  reason: '사유',
  keyId: '승인 키',
  self: '본인 승인',
  planHash: 'Plan 해시',
  source: '요청 경로',
  retry: '재시도',
  changes: 'Plan 변경',
  answer: '확인 질문 답변',
  direct: '관리자 직접 추가',
  documentId: '문서',
  version: '문서 버전',
  ownerIds: '담당자',
  failedChecks: '실패 항목',
  format: '형식',
  filters: '조건',
  rowCount: '건수',
}

export const EXPORT_FORMAT_LABEL: Record<ExportFormat, string> = { XLSX: '엑셀', CSV: 'CSV' }
export const EXPORT_STATUS_LABEL: Record<ExportStatus, string> = {
  PROCESSING: '만드는 중',
  READY: '준비됨',
  FAILED: '실패',
  EXPIRED: '만료됨',
}

export const APPROVAL_DOCUMENT_STATUS_LABEL: Record<ApprovalDocumentStatus, string> = {
  IN_PROGRESS: '승인 진행 중',
  APPROVED: '승인 완료',
  REVISING: 'Plan 수정 중',
  SUPERSEDED: '이전 판',
  REJECTED: '거부됨',
  CANCELED: '취소됨',
  KILLED: '중단됨',
}
