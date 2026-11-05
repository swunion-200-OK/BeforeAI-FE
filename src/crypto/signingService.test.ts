import { ed25519 } from '@noble/curves/ed25519.js'
import { beforeEach, describe, expect, it } from 'vitest'
import { deviceStore } from './deviceStore'
import { base64ToBytes } from './encoding'
import { signingService } from './signingService'

describe('승인 키 등록 서명', () => {
  beforeEach(() => deviceStore.clear())

  it('백엔드가 검증하는 문자열에 표준 base64 64바이트 서명을 만든다', () => {
    const { publicKey } = signingService.generateDeviceKey('admin')
    deviceStore.update('admin', { keyId: 'proof-key' })
    const proof = signingService.signRegisterProof('admin', { id: 'target-id', publicKey: 'target-public' })

    expect(proof.keyId).toBe('proof-key')
    const signature = base64ToBytes(proof.signature as string)
    expect(signature).toHaveLength(64)
    const message = new TextEncoder().encode('beforeai:register-signing-key:target-id:target-public')
    expect(ed25519.verify(signature, message, base64ToBytes(publicKey))).toBe(true)
  })

  it('이 기기에 키가 없으면 서명을 지어내지 않는다', () => {
    expect(() => signingService.signRegisterProof('admin', { id: 'a', publicKey: 'b' })).toThrow('관리자 승인 키가 없습니다')
  })
})
