import type { AdminProof } from '../api/types'
import { deviceStore } from './deviceStore'

/**
 * TODO(spec): 정책 변경의 관리자 서명은 서명 대상이 아직 정해지지 않았다. 진짜 서명이 아니라 자리 표시 값이다.
 * 서버는 키 ID와 서명 문자열이 비어 있지 않은지만 본다 (StubAdminProofVerifier). 공개키 등록 서명 규칙은 정책에 쓰지 말라고 백엔드가 정했다 (AGENT.md).
 * 대상이 정해지면 여기서 실제로 서명하고 이 값과 UNSIGNED_POLICY_NOTICE를 지운다.
 */
export const UNSIGNED_POLICY_SIGNATURE = 'UNSIGNED-PLACEHOLDER-TODO-SPEC'

/** 화면이 서명된 변경이라고 말하지 않게 확인 창에 함께 보여 준다. */
export const UNSIGNED_POLICY_NOTICE = '관리자 서명 규칙이 아직 정해지지 않아, 이 변경에는 실제 서명이 붙지 않습니다.'

/** 서버가 adminProof를 요구하는 정책 변경에만 쓴다. 키 ID는 UUID여야 해서 지어내지 않고 이 기기의 키를 쓴다. */
export function policyAdminProof(userId: string): Required<AdminProof> {
  const { keyId } = deviceStore.get(userId)
  if (!keyId) throw new Error('이 기기에 관리자 승인 키가 없습니다. 내 정보에서 키를 만들어 주세요')
  return { keyId, signature: UNSIGNED_POLICY_SIGNATURE }
}
