import type { Network, RequestStatus } from '../api/types'

/** 개발 도구의 시연 가이드 내용. 제품 기능이 아니라 목 데이터로 흐름을 둘러보기 위한 목록이다. */

export const SCENARIO_PROMPT = '로그인 실패 시 에러 메시지를 바꾸고 스테이징에 배포해줘'

export interface DemoStep {
  /** 무엇을 보거나 하는지 */
  label: string
  userId: string
  network: Network
  /** latestId: 시나리오 프롬프트로 만든 가장 최근 요청 (없으면 시드 r-main) */
  path: (latestId: string) => string
}

export interface DemoGroup {
  title: string
  steps: DemoStep[]
}

const HONG = 'u-01'
const KIM = 'u-07'
const LEE = 'u-09'
const CTO = 'u-admin'
const MANAGER = 'u-mgr-be'
const INFRA = 'u-21'
const NEWBIE = 'u-31'
const fixed = (path: string) => () => path

export const DEMO_SCENARIOS: DemoGroup[] = [
  {
    title: '승인에서 실행까지',
    steps: [
      {
        label: '작업을 요청하고 제출합니다. 코드 작업은 본인 승인됩니다',
        userId: HONG,
        network: 'INTERNAL',
        path: () => `/requests/new?prompt=${encodeURIComponent(SCENARIO_PROMPT)}`,
      },
      {
        label: '외부망에서 열면 배포 작업이 막혀 있습니다',
        userId: KIM,
        network: 'EXTERNAL',
        path: (id) => `/approvals/${id}`,
      },
      {
        label: '내부망에서 배포 작업에 승인 서명을 합니다',
        userId: KIM,
        network: 'INTERNAL',
        path: (id) => `/approvals/${id}`,
      },
      {
        label: '실행 로그를 실시간으로 보고 완료를 확인합니다',
        userId: HONG,
        network: 'INTERNAL',
        path: (id) => `/requests/${id}`,
      },
    ],
  },
  {
    title: '재승인',
    steps: [
      {
        label: '승인 대기 중인 요청의 작업을 수정해 봅니다',
        userId: HONG,
        network: 'INTERNAL',
        path: fixed('/requests/r-main'),
      },
      {
        label: '재승인필요 화면: 바뀐 작업이 강조됩니다',
        userId: HONG,
        network: 'INTERNAL',
        path: fixed('/requests/r-reapproval'),
      },
    ],
  },
  {
    title: '차단',
    steps: [
      { label: '금지 작업이 포함된 Plan', userId: HONG, network: 'INTERNAL', path: fixed('/requests/new/r-forbidden') },
      { label: '웹쉘 검증 실패와 실패 항목', userId: HONG, network: 'INTERNAL', path: fixed('/requests/r-verify-failed') },
      { label: 'Plan이 변조되어 서명이 잠긴 화면', userId: KIM, network: 'INTERNAL', path: fixed('/approvals/r-tampered-hash') },
      { label: '화면 내용이 서명 대상과 다른 경우', userId: KIM, network: 'INTERNAL', path: fixed('/approvals/r-display-mismatch') },
    ],
  },
  {
    title: '관리자 현황',
    steps: [
      { label: '전사 대시보드', userId: CTO, network: 'INTERNAL', path: fixed('/dashboard') },
      {
        label: '감사 로그에서 외부망 승인 기록 찾기',
        userId: CTO,
        network: 'INTERNAL',
        path: fixed('/audit?network=EXTERNAL&action=APPROVAL_SUBMITTED'),
      },
    ],
  },
  {
    title: '그 밖의 흐름',
    steps: [
      { label: '외부망에서 코드 작업만 승인', userId: KIM, network: 'EXTERNAL', path: fixed('/approvals/r-external') },
      { label: 'AI 완성 문서를 적용 / 미적용', userId: KIM, network: 'INTERNAL', path: fixed('/approvals/r-doc') },
      { label: '문서 버전과 롤백', userId: HONG, network: 'INTERNAL', path: fixed('/documents/doc-readme') },
      { label: '실행 중 요청과 킬 스위치', userId: HONG, network: 'INTERNAL', path: fixed('/requests/r-running') },
      { label: '부분완료와 실패 작업 재시도', userId: HONG, network: 'INTERNAL', path: fixed('/requests/r-partial') },
      { label: 'AI 확인 질문에 답하기', userId: HONG, network: 'INTERNAL', path: fixed('/requests/new/r-clarify') },
      { label: '분석 실패와 재시도', userId: HONG, network: 'INTERNAL', path: fixed('/requests/new/r-analysis-failed') },
      { label: '웹 코드 에디터로 급한 수정', userId: HONG, network: 'INTERNAL', path: fixed('/editor/prj-auth') },
      { label: '승인 키 만들기 (키 없는 사용자)', userId: INFRA, network: 'INTERNAL', path: fixed('/me') },
      { label: '승인 키 등록 대기 화면', userId: LEE, network: 'INTERNAL', path: fixed('/me') },
      { label: '관리자의 승인 키 등록', userId: CTO, network: 'INTERNAL', path: fixed('/settings/keys') },
      { label: '기획서 수정과 담당자 관리', userId: MANAGER, network: 'INTERNAL', path: fixed('/projects/prj-auth') },
      { label: '직원의 기획서 수정 요청', userId: HONG, network: 'INTERNAL', path: fixed('/projects/prj-auth') },
      { label: '팀장의 금지 작업 제안', userId: MANAGER, network: 'INTERNAL', path: fixed('/forbidden') },
      { label: '관리자의 금지 작업 확정', userId: CTO, network: 'INTERNAL', path: fixed('/settings/forbidden') },
      { label: '승인 기준표와 규모 프리셋', userId: CTO, network: 'INTERNAL', path: fixed('/settings/policy') },
      { label: '계정 발급과 권한', userId: CTO, network: 'INTERNAL', path: fixed('/settings/accounts') },
      { label: '전사 일괄 중단', userId: CTO, network: 'INTERNAL', path: fixed('/settings/emergency') },
      { label: '최초 로그인 비밀번호 변경', userId: NEWBIE, network: 'INTERNAL', path: fixed('/dashboard') },
    ],
  },
]

/** 상태 배지 16종을 시드 요청으로 바로 볼 수 있게 한다. */
export const DEMO_STATUSES: Array<{ status: RequestStatus; path: string; userId: string }> = [
  { status: 'ANALYZING', path: '/requests/new/r-analyzing', userId: HONG },
  { status: 'ANALYSIS_FAILED', path: '/requests/new/r-analysis-failed', userId: HONG },
  { status: 'REVIEWING', path: '/requests/new/r-reviewing', userId: HONG },
  { status: 'PENDING_APPROVAL', path: '/requests/r-main', userId: HONG },
  { status: 'REAPPROVAL_REQUIRED', path: '/requests/r-reapproval', userId: HONG },
  { status: 'VERIFICATION_FAILED', path: '/requests/r-verify-failed', userId: HONG },
  { status: 'REJECTED', path: '/requests/r-rejected', userId: HONG },
  { status: 'CANCELED', path: '/requests/r-canceled', userId: HONG },
  { status: 'RUNNING', path: '/requests/r-running', userId: HONG },
  { status: 'KILLED', path: '/requests/r-killed', userId: HONG },
  { status: 'COMPLETED', path: '/requests/r-completed', userId: HONG },
  { status: 'PARTIALLY_COMPLETED', path: '/requests/r-partial', userId: HONG },
  { status: 'FAILED', path: '/requests/r-failed', userId: INFRA },
  { status: 'ROLLING_BACK', path: '/requests/r-rolling-back', userId: HONG },
  { status: 'ROLLED_BACK', path: '/requests/r-rolled-back', userId: HONG },
  { status: 'ROLLBACK_FAILED', path: '/requests/r-rollback-failed', userId: HONG },
]
