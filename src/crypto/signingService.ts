import { ed25519 } from '@noble/curves/ed25519.js'
import type { AdminProof, ApprovalPayload, SignedApproval, SigningKey } from '../api/types'
import { deviceStore } from './deviceStore'
import { base64ToBytes, bytesToBase64 } from './encoding'
import { canonicalize } from './hashService'
import { privateSigningKeyStore, type PrivateSigningKeyRecord } from './privateSigningKeyStore'

const encoder = new TextEncoder()
const ED25519_PKCS8_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
])

type RegisterTarget = Pick<SigningKey, 'id' | 'publicKey'>

/** 승인 키 등록의 서명 대상. 백엔드 SigningKeyAdminService와 글자까지 같아야 한다. */
function registerProofMessage(target: RegisterTarget): Uint8Array<ArrayBuffer> {
  return encoder.encode(`beforeai:register-signing-key:${target.id}:${target.publicKey}`)
}

function subtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('이 브라우저는 안전한 승인 키 기능을 지원하지 않습니다. 최신 HTTPS 브라우저에서 다시 시도해 주세요.')
  return subtle
}

function concatenate(left: Uint8Array, right: Uint8Array): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(left.length + right.length)
  result.set(left)
  result.set(right, left.length)
  return result
}

async function importPrivateSeed(userId: string, secret: Uint8Array, expectedPublicKey?: string): Promise<string> {
  if (secret.length !== 32) throw new Error('기존 승인 키의 형식이 올바르지 않습니다')
  const publicKeyBytes = ed25519.getPublicKey(secret)
  const publicKey = bytesToBase64(publicKeyBytes)
  if (expectedPublicKey && publicKey !== expectedPublicKey) {
    throw new Error('기존 승인 키와 공개키가 일치하지 않습니다')
  }

  const privateKey = await subtleCrypto().importKey(
    'pkcs8',
    concatenate(ED25519_PKCS8_PREFIX, secret),
    { name: 'Ed25519' },
    false,
    ['sign'],
  )
  await verifyInteroperability(privateKey, publicKeyBytes)
  await privateSigningKeyStore.put({ userId, privateKey, publicKey })
  return publicKey
}

async function verifyInteroperability(privateKey: CryptoKey, publicKey: Uint8Array): Promise<void> {
  const challenge = encoder.encode('beforeai:non-extractable-key-check')
  const signature = new Uint8Array(await subtleCrypto().sign({ name: 'Ed25519' }, privateKey, challenge))
  if (!ed25519.verify(signature, challenge, publicKey)) {
    throw new Error('브라우저의 Ed25519 서명 결과를 확인하지 못했습니다')
  }
}

async function privateKeyFor(userId: string): Promise<PrivateSigningKeyRecord> {
  if (deviceStore.get(userId).keyMigrationStatus === 'NEEDS_REENROLLMENT') {
    throw new Error('기존 승인 키를 안전하게 옮기지 못했습니다. 관리자 등록을 다시 받아 주세요')
  }
  const record = await privateSigningKeyStore.get(userId)
  if (!record || record.privateKey.extractable || record.privateKey.algorithm.name !== 'Ed25519') {
    throw new Error('이 브라우저에 안전한 승인 키가 없습니다. 내 정보에서 키를 다시 등록해 주세요')
  }
  return record
}

export const signingService = {
  /** v2의 평문 키를 비추출 CryptoKey로 옮긴다. 옮길 수 없는 키는 지우고 재등록을 요구한다. */
  async initialize(): Promise<void> {
    const legacyEntries = deviceStore.readLegacyEntries()
    const entries = Object.entries(legacyEntries)
    if (entries.length === 0) {
      deviceStore.discardLegacyStorage()
      return
    }

    const migrated: Record<string, Omit<(typeof legacyEntries)[string], 'secretKey'>> = {}
    for (const [userId, legacy] of entries) {
      const { secretKey, ...metadata } = legacy
      try {
        if (secretKey) {
          const existing = await privateSigningKeyStore.get(userId)
          let publicKey: string
          if (existing) {
            if (existing.publicKey !== metadata.publicKey || existing.privateKey.extractable) {
              throw new Error('기존 키와 IndexedDB 키가 일치하지 않습니다')
            }
            publicKey = existing.publicKey
          } else {
            publicKey = await importPrivateSeed(userId, base64ToBytes(secretKey), metadata.publicKey)
          }
          migrated[userId] = { ...metadata, publicKey, keyMigrationStatus: undefined }
        } else {
          migrated[userId] = metadata.keyId
            ? { ...metadata, keyMigrationStatus: 'NEEDS_REENROLLMENT' }
            : metadata
        }
      } catch {
        await privateSigningKeyStore.delete(userId).catch(() => undefined)
        migrated[userId] = { ...metadata, keyMigrationStatus: 'NEEDS_REENROLLMENT' }
      }
    }

    // IndexedDB에 저장한 뒤에만 v2를 제거한다. 저장 실패 시 기존 키는 재등록 안내로 대체한다.
    deviceStore.completeLegacyMigration(migrated)
  },

  /** 키 쌍을 만들고, 추출할 수 없는 개인키를 IndexedDB에 저장한다. */
  async generateDeviceKey(userId: string): Promise<{ publicKey: string }> {
    const pair = (await subtleCrypto().generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])) as CryptoKeyPair
    if (pair.privateKey.extractable) throw new Error('브라우저가 비추출 승인 키를 만들지 못했습니다')
    const publicKey = bytesToBase64(new Uint8Array(await subtleCrypto().exportKey('raw', pair.publicKey)))
    await privateSigningKeyStore.put({ userId, privateKey: pair.privateKey, publicKey })
    deviceStore.update(userId, { publicKey, keyMigrationStatus: undefined })
    return { publicKey }
  },

  /** 목의 시연 키도 브라우저 저장소에는 원문을 남기지 않고 IndexedDB에 둔다. */
  async importDeviceKey(userId: string, secret: Uint8Array, expectedPublicKey?: string): Promise<string> {
    const publicKey = await importPrivateSeed(userId, secret, expectedPublicKey)
    deviceStore.update(userId, { publicKey, keyMigrationStatus: undefined })
    return publicKey
  },

  async hasDeviceKey(userId: string): Promise<boolean> {
    const record = await privateSigningKeyStore.get(userId)
    return Boolean(record && !record.privateKey.extractable && record.privateKey.algorithm.name === 'Ed25519')
  },

  async snapshotDeviceKey(userId: string): Promise<PrivateSigningKeyRecord | null> {
    return privateSigningKeyStore.get(userId)
  },

  async restoreDeviceKey(userId: string, record: PrivateSigningKeyRecord | null): Promise<void> {
    if (record) await privateSigningKeyStore.put(record)
    else await privateSigningKeyStore.delete(userId)
  },

  /** payload를 JCS로 정규화해 기기 개인키로 서명한다 (명세 2.4). */
  async sign(userId: string, payload: ApprovalPayload): Promise<SignedApproval> {
    const { privateKey } = await privateKeyFor(userId)
    const message = encoder.encode(canonicalize(payload))
    const signature = await subtleCrypto().sign({ name: 'Ed25519' }, privateKey, message)
    return { payload, signature: bytesToBase64(new Uint8Array(signature)) }
  },

  /** 관리자가 이 기기의 키로 승인 키 등록에 서명한다. */
  async signRegisterProof(userId: string, target: RegisterTarget): Promise<AdminProof> {
    const { keyId } = deviceStore.get(userId)
    if (!keyId) throw new Error('이 기기에 관리자 승인 키가 없습니다. 내 정보에서 키를 만들어 주세요')
    const { privateKey } = await privateKeyFor(userId)
    const signature = await subtleCrypto().sign({ name: 'Ed25519' }, privateKey, registerProofMessage(target))
    return { keyId, signature: bytesToBase64(new Uint8Array(signature)) }
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
