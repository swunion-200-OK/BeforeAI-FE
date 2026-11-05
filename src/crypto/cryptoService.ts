import type { ApprovalEnvelope, SignedApproval } from '../api/types'
import { base64ToUtf8, bytesToBase64, utf8ToBase64 } from './encoding'

/**
 * MOCK: 실제 HPKE(X25519 + AES-256-GCM) 대신 받는 쪽 공개키를 적어 base64로 감싸기만 한다.
 * 호출 지점과 봉투 모양은 명세 2.4와 같으므로 이 두 함수만 바꾸면 된다.
 */
export const cryptoService = {
  /** 승인자 기기: 고정해 둔 웹쉘 공개키로 암호화한다. */
  encryptForWebshell(signed: SignedApproval, webshellEncryptionKey: string): ApprovalEnvelope {
    return {
      alg: 'HPKE-X25519-AES256GCM',
      encapsulatedKey: bytesToBase64(crypto.getRandomValues(new Uint8Array(32))),
      ciphertext: utf8ToBase64(JSON.stringify({ recipient: webshellEncryptionKey, signed })),
    }
  },

  /** 웹쉘: 자기 키로 연다. 변조됐거나 다른 키로 암호화했으면 예외를 던진다. */
  decryptForWebshell(envelope: ApprovalEnvelope, webshellEncryptionKey: string): SignedApproval {
    const { recipient, signed } = JSON.parse(base64ToUtf8(envelope.ciphertext)) as {
      recipient: string
      signed: SignedApproval
    }
    if (recipient !== webshellEncryptionKey) throw new Error('다른 키로 암호화한 봉투입니다')
    return signed
  },
}
