import type {
  ApproverRule,
  AuditAction,
  FailedCheck,
  Network,
  PolicyPreset,
  RequestSource,
  RequestStatus,
  Risk,
  Role,
  TaskStatus,
  TaskType,
} from '../api/types'

export const RISK_LABEL: Record<Risk, string> = { LOW: '낮음', MEDIUM: '중간', HIGH: '높음', FORBIDDEN: '금지' }
export const RISK_EMOJI: Record<Risk, string> = { LOW: '🟢', MEDIUM: '🟠', HIGH: '🔴', FORBIDDEN: '🔒' }

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
export const REQUEST_STATUSES = Object.keys(REQUEST_STATUS_LABEL) as RequestStatus[]

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
  PLAN_HASH_MISMATCH: '다시 계산한 해시가 보관한 해시 또는 서명의 해시와 다름',
  UNKNOWN_PLAN: '실행기가 만들지 않은 해시',
  SIGNATURE_INVALID: '서명이 공개키로 검증되지 않음',
  KEY_NOT_REGISTERED: '로컬 정책에 없거나 폐기된 키',
  NONCE_ALREADY_USED: '이미 실행에 쓴 서명',
  MISSING_REQUIRED_APPROVER: '필요한 승인권자의 서명이 없음',
  FORBIDDEN_TASK: '로컬 정책의 금지 작업이 포함됨',
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
}
