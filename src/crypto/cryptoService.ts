import type { ApprovalEnvelope, SignedApproval } from '../api/types'
import { bytesToBase64, utf8ToBase64 } from './encoding'

/**
 * MOCK: 실제 HPKE(X25519 + AES-256-GCM) 대신 base64로 감싸기만 한다.
 * 호출 지점과 봉투 모양은 명세 2.4와 같으므로 이 함수만 바꾸면 된다.
 */
export const cryptoService = {
  encryptForExecutor(signed: SignedApproval, _executorPublicKey: string): ApprovalEnvelope {
    return {
      alg: 'HPKE-X25519-AES256GCM',
      encapsulatedKey: bytesToBase64(crypto.getRandomValues(new Uint8Array(32))),
      ciphertext: utf8ToBase64(JSON.stringify(signed)),
    }
  },
}
