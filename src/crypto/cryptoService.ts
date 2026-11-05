import { gcm } from '@noble/ciphers/aes.js'
import { x25519 } from '@noble/curves/ed25519.js'
import { expand, extract } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { concatBytes } from '@noble/hashes/utils.js'
import type { ApprovalEnvelope, SignedApproval } from '../api/types'
import { base64ToBytes, bytesToBase64 } from './encoding'

const encoder = new TextEncoder()
const EMPTY = new Uint8Array(0)

const ENVELOPE_ALG: ApprovalEnvelope['alg'] = 'HPKE-X25519-AES256GCM'
const X25519_KEY_LENGTH = 32

/**
 * TODO(spec): 명세 2.4는 알고리즘과 봉투 모양만 정하고 아래 값은 정하지 않았다. 웹쉘과 같은 값을 써야 열 수 있다.
 * - info와 AAD: 임시로 아래 값을 쓴다.
 * - 공개키와 encapsulatedKey: X25519 키 32바이트 그대로를 표준 base64로 적는다 (SPKI·PEM 아님).
 * - ciphertext: AES-GCM 암호문 뒤에 태그 16바이트를 붙여 표준 base64로 적는다 (RFC 9180 Seal 출력).
 * - 평문: JSON.stringify({ payload, signature })의 UTF-8. 서명은 JCS(payload)에 하므로 키 순서는 검증과 무관하다.
 */
export const HPKE_INFO = encoder.encode('beforeai-approval-envelope-v1')
export const HPKE_AAD = EMPTY

// ── RFC 9180 HPKE: DHKEM(X25519, HKDF-SHA256) / HKDF-SHA256 / AES-256-GCM, base mode ───

const HPKE_VERSION = encoder.encode('HPKE-v1')
const KEM_SUITE = concatBytes(encoder.encode('KEM'), new Uint8Array([0x00, 0x20]))
const HPKE_SUITE = concatBytes(encoder.encode('HPKE'), new Uint8Array([0x00, 0x20, 0x00, 0x01, 0x00, 0x02]))

function labeledExtract(suite: Uint8Array, salt: Uint8Array, label: string, ikm: Uint8Array): Uint8Array {
  return extract(sha256, concatBytes(HPKE_VERSION, suite, encoder.encode(label), ikm), salt)
}

function labeledExpand(suite: Uint8Array, prk: Uint8Array, label: string, info: Uint8Array, length: number): Uint8Array {
  const labeled = concatBytes(new Uint8Array([0, length]), HPKE_VERSION, suite, encoder.encode(label), info)
  return expand(sha256, prk, labeled, length)
}

/** DHKEM의 ExtractAndExpand. 저차 공개키는 x25519.getSharedSecret이 먼저 거부한다. */
function kemSharedSecret(dh: Uint8Array, encapsulatedKey: Uint8Array, recipientPublic: Uint8Array): Uint8Array {
  const prk = labeledExtract(KEM_SUITE, EMPTY, 'eae_prk', dh)
  return labeledExpand(KEM_SUITE, prk, 'shared_secret', concatBytes(encapsulatedKey, recipientPublic), 32)
}

/** 봉투마다 한 번만 암호화하므로 시퀀스 0의 nonce는 base_nonce 그대로다. */
function aeadFor(sharedSecret: Uint8Array) {
  const context = concatBytes(
    new Uint8Array([0x00]),
    labeledExtract(HPKE_SUITE, EMPTY, 'psk_id_hash', EMPTY),
    labeledExtract(HPKE_SUITE, EMPTY, 'info_hash', HPKE_INFO),
  )
  const secret = labeledExtract(HPKE_SUITE, sharedSecret, 'secret', EMPTY)
  const key = labeledExpand(HPKE_SUITE, secret, 'key', context, 32)
  const nonce = labeledExpand(HPKE_SUITE, secret, 'base_nonce', context, 12)
  return gcm(key, nonce, HPKE_AAD)
}

function seal(recipientPublic: Uint8Array, plaintext: Uint8Array) {
  const { secretKey, publicKey: encapsulatedKey } = x25519.keygen()
  const dh = x25519.getSharedSecret(secretKey, recipientPublic)
  const ciphertext = aeadFor(kemSharedSecret(dh, encapsulatedKey, recipientPublic)).encrypt(plaintext)
  return { encapsulatedKey, ciphertext }
}

function open(recipientSecret: Uint8Array, encapsulatedKey: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  const dh = x25519.getSharedSecret(recipientSecret, encapsulatedKey)
  const recipientPublic = x25519.getPublicKey(recipientSecret)
  return aeadFor(kemSharedSecret(dh, encapsulatedKey, recipientPublic)).decrypt(ciphertext)
}

// ── 봉투 ───────────────────────────────────────────────────

function decodeKey(value: string, label: string): Uint8Array {
  let bytes: Uint8Array
  try {
    bytes = base64ToBytes(value)
  } catch {
    throw new Error(`${label}가 base64 형식이 아닙니다`)
  }
  if (bytes.length !== X25519_KEY_LENGTH) {
    throw new Error(`${label}는 ${X25519_KEY_LENGTH}바이트여야 합니다 (받은 길이: ${bytes.length}바이트)`)
  }
  return bytes
}

/** 공개키만 있으면 누구나 봉투를 만들 수 있으므로, 잘 열렸어도 내용의 모양을 확인한다. 서명 검증은 호출하는 쪽의 일이다. */
function parseSignedApproval(plaintext: Uint8Array): SignedApproval {
  let parsed: Partial<SignedApproval> | null = null
  try {
    parsed = JSON.parse(new TextDecoder().decode(plaintext)) as Partial<SignedApproval> | null
  } catch {
    // 아래에서 같은 이유로 거부한다.
  }
  if (typeof parsed?.payload !== 'object' || parsed.payload === null || typeof parsed.signature !== 'string') {
    throw new Error('봉투 안에 승인 서명이 없습니다')
  }
  return parsed as SignedApproval
}

export const cryptoService = {
  /** 승인자 기기: 고정해 둔 웹쉘 공개키로 암호화한다. 키가 잘못됐으면 봉투를 만들지 않고 예외를 던진다. */
  encryptForWebshell(signed: SignedApproval, webshellEncryptionKey: string): ApprovalEnvelope {
    const recipientPublic = decodeKey(webshellEncryptionKey, '웹쉘 공개키')
    const plaintext = encoder.encode(JSON.stringify(signed))
    let sealed: ReturnType<typeof seal>
    try {
      sealed = seal(recipientPublic, plaintext)
    } catch {
      throw new Error('웹쉘 공개키가 올바른 X25519 공개키가 아닙니다')
    }
    return {
      alg: ENVELOPE_ALG,
      encapsulatedKey: bytesToBase64(sealed.encapsulatedKey),
      ciphertext: bytesToBase64(sealed.ciphertext),
    }
  },

  /** 웹쉘: 자기 개인키로 연다. 알고리즘이 다르거나 변조됐거나 다른 키로 암호화했으면 예외를 던진다. */
  decryptForWebshell(envelope: ApprovalEnvelope, webshellSecretKey: Uint8Array): SignedApproval {
    if (envelope.alg !== ENVELOPE_ALG) throw new Error(`지원하지 않는 봉투 알고리즘입니다: ${String(envelope.alg)}`)
    if (webshellSecretKey.length !== X25519_KEY_LENGTH) {
      throw new Error(`웹쉘 개인키는 ${X25519_KEY_LENGTH}바이트여야 합니다`)
    }
    const encapsulatedKey = decodeKey(envelope.encapsulatedKey, 'encapsulatedKey')
    let plaintext: Uint8Array
    try {
      plaintext = open(webshellSecretKey, encapsulatedKey, base64ToBytes(envelope.ciphertext))
    } catch {
      throw new Error('봉투를 열 수 없습니다. 변조됐거나 다른 키로 암호화했습니다')
    }
    return parseSignedApproval(plaintext)
  },
}
