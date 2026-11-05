import { ed25519 } from '@noble/curves/ed25519.js'
import type { AdminProof, ApprovalPayload, SignedApproval, SigningKey } from '../api/types'
import { deviceStore } from './deviceStore'
import { base64ToBytes, bytesToBase64 } from './encoding'
import { canonicalize } from './hashService'

const encoder = new TextEncoder()

type RegisterTarget = Pick<SigningKey, 'id' | 'publicKey'>

/** 승인 키 등록의 서명 대상. 백엔드 SigningKeyAdminService와 글자까지 같아야 한다. */
function registerProofMessage(target: RegisterTarget): Uint8Array {
  return encoder.encode(`beforeai:register-signing-key:${target.id}:${target.publicKey}`)
}

export const signingService = {
  /** 이 기기에서 Ed25519 키 쌍을 만든다. 개인키는 기기 밖으로 나가지 않는다. */
  generateDeviceKey(userId: string): { publicKey: string } {
    const secret = ed25519.utils.randomSecretKey()
    const publicKey = bytesToBase64(ed25519.getPublicKey(secret))
    deviceStore.update(userId, { secretKey: bytesToBase64(secret), publicKey })
    return { publicKey }
  },

  hasDeviceKey(userId: string): boolean {
    return Boolean(deviceStore.get(userId).secretKey)
  },

  /** payload를 JCS로 정규화해 기기 개인키로 서명한다 (명세 2.4). */
  sign(userId: string, payload: ApprovalPayload): SignedApproval {
    const { secretKey } = deviceStore.get(userId)
    if (!secretKey) throw new Error('이 기기에 승인 키가 없습니다')
    const message = encoder.encode(canonicalize(payload))
    return { payload, signature: bytesToBase64(ed25519.sign(message, base64ToBytes(secretKey))) }
  },

  /** 관리자가 이 기기의 키로 승인 키 등록에 서명한다. */
  signRegisterProof(userId: string, target: RegisterTarget): AdminProof {
    const { keyId, secretKey } = deviceStore.get(userId)
    if (!keyId || !secretKey) throw new Error('이 기기에 관리자 승인 키가 없습니다. 내 정보에서 키를 만들어 주세요')
    return { keyId, signature: bytesToBase64(ed25519.sign(registerProofMessage(target), base64ToBytes(secretKey))) }
  },

  verifyRegisterProof(signature: string, target: RegisterTarget, proofPublicKey: string): boolean {
    return verify(signature, registerProofMessage(target), proofPublicKey)
  },

  verifyApproval(signed: SignedApproval, publicKey: string): boolean {
    return verify(signed.signature, encoder.encode(canonicalize(signed.payload)), publicKey)
  },

  /**
   * 웹쉘이 보낸 실행 결과·로그의 서명을 고정해 둔 웹쉘 서명 공개키로 확인한다.
   * TODO(spec): 확인 결과를 화면에 어떻게 보여 줄지는 명세에 없어 아직 화면에서 부르지 않는다.
   */
  verifyWebshellSignature(signedValue: unknown, signature: string, pinnedSigningKey: string): boolean {
    return verify(signature, encoder.encode(canonicalize(signedValue)), pinnedSigningKey)
  },
}

function verify(signature: string, message: Uint8Array, publicKey: string): boolean {
  try {
    return ed25519.verify(base64ToBytes(signature), message, base64ToBytes(publicKey))
  } catch {
    return false
  }
}
