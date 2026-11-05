import { USE_MOCK } from '../../api/client'

/**
 * 실제 서버는 웹쉘 경보를 서버 로그에만 남기고 사람에게 보내지 않는다 (ExecutionEventService).
 * 보낸 적 없는 경보를 보냈다고 말하지 않는다. 목은 시연의 경보 흐름이 있어 그대로 둔다.
 */
export function verificationFailedTitle(mock = USE_MOCK): string {
  return mock ? '위변조 가능성이 있어 관리자와 부서 관리자에게 경보를 보냈습니다' : '웹쉘이 검증에 실패해 실행하지 않았습니다'
}

/**
 * 승인이 다 모였는데 웹쉘에 연결하지 못한 경우. 서명은 저장되고 실행 시작만 실패한다 (서버 ApprovalService.approve).
 * 실제 서버는 스스로 다시 시도하지 않아 화면의 버튼으로 다시 요청한다. 목은 스스로 다시 시도한다.
 */
export function executionDeferredText(mock = USE_MOCK): string {
  return mock ? '웹쉘에 연결할 수 없어 실행 요청을 다시 시도합니다' : '웹쉘에 연결할 수 없어 실행하지 못했습니다. 연결되면 실행을 다시 요청해 주세요'
}

export function executionDeferredBanner(mock = USE_MOCK): { title: string; body: string } {
  return mock
    ? { title: '승인은 모두 모였지만 웹쉘에 연결할 수 없습니다', body: '연결되면 실행을 자동으로 다시 요청합니다.' }
    : { title: '승인 서명은 저장했지만 실행하지 못했습니다', body: '웹쉘에 연결할 수 없습니다. 자동으로 다시 시도하지 않으니, 연결되면 실행을 다시 요청해 주세요.' }
}

export function allApprovedNowText(mock = USE_MOCK): string {
  return mock ? '승인이 모두 모였습니다. 웹쉘에 실행을 요청하는 중입니다' : '승인이 모두 모였지만 아직 실행되지 않았습니다'
}

export function rollbackFailedText(mock = USE_MOCK): string {
  const retry = '문서 화면에서 다시 롤백을 요청할 수 있으며, 새 서명이 필요합니다.'
  return mock ? `관리자와 담당자에게 경보를 보냈습니다. ${retry}` : retry
}
