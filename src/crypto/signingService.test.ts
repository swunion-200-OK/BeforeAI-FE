import 'fake-indexeddb/auto'
import { ed25519 } from '@noble/curves/ed25519.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deviceStore } from './deviceStore'
import { base64ToBytes, bytesToBase64 } from './encoding'
import { signingService } from './signingService'

class MemoryStorage {
  private map = new Map<string, string>()
  getItem = (key: string) => this.map.get(key) ?? null
  setItem = (key: string, value: string) => void this.map.set(key, value)
  removeItem = (key: string) => void this.map.delete(key)
}

let storage: MemoryStorage

describe('브라우저 승인 키 보관', () => {
  beforeEach(async () => {
    storage = new MemoryStorage()
    vi.stubGlobal('localStorage', storage)
    await deviceStore.clear()
  })

  it('등록 증명에 백엔드가 검증하는 base64 64바이트 서명을 만든다', async () => {
    const { publicKey } = await signingService.generateDeviceKey('admin')
    deviceStore.update('admin', { keyId: 'proof-key' })
    const proof = await signingService.signRegisterProof('admin', { id: 'target-id', publicKey: 'target-public' })

    expect(proof.keyId).toBe('proof-key')
    const signature = base64ToBytes(proof.signature as string)
    expect(signature).toHaveLength(64)
    const message = new TextEncoder().encode('beforeai:register-signing-key:target-id:target-public')
    expect(ed25519.verify(signature, message, base64ToBytes(publicKey))).toBe(true)
  })

  it('비추출 CryptoKey로 승인 서명을 만들고 다른 사용자 키와 분리한다', async () => {
    const { publicKey } = await signingService.generateDeviceKey('user-a')
    const stored = JSON.parse(storage.getItem('beforeai.device.v3') ?? '{}')
    expect(JSON.stringify(stored)).not.toContain('secretKey')
    expect(await signingService.hasDeviceKey('user-a')).toBe(true)
    expect(await signingService.hasDeviceKey('user-b')).toBe(false)

    const payload = { requestId: 'request-1', approverId: 'user-a' } as never
    const signed = await signingService.sign('user-a', payload)
    expect(signingService.verifyApproval(signed, publicKey)).toBe(true)
    expect((await signingService.snapshotDeviceKey('user-a'))?.privateKey.extractable).toBe(false)
  })

  it('이 기기에 관리자 키가 없으면 등록 증명을 만들지 않는다', async () => {
    await expect(signingService.signRegisterProof('admin', { id: 'a', publicKey: 'b' })).rejects.toThrow(
      '이 기기에 관리자 승인 키가 없습니다',
    )
  })

  it('기존 localStorage 키를 IndexedDB로 옮긴 뒤 원문을 제거한다', async () => {
    const secret = new Uint8Array(32).fill(7)
    const publicKey = bytesToBase64(ed25519.getPublicKey(secret))
    storage.setItem(
      'beforeai.device.v2',
      JSON.stringify({ 'user-a': { keyId: 'key-a', publicKey, secretKey: bytesToBase64(secret) } }),
    )

    await signingService.initialize()

    expect(storage.getItem('beforeai.device.v2')).toBeNull()
    expect(storage.getItem('beforeai.device.v3')).not.toContain('secretKey')
    expect(await signingService.hasDeviceKey('user-a')).toBe(true)
    expect(await signingService.sign('user-a', { value: 'migrated' } as never)).toMatchObject({ payload: { value: 'migrated' } })
  })

  it('손상된 기존 키는 지우고 재등록이 필요하다고 표시한다', async () => {
    storage.setItem(
      'beforeai.device.v2',
      JSON.stringify({ 'user-a': { keyId: 'key-a', publicKey: 'wrong-public-key', secretKey: bytesToBase64(new Uint8Array(32).fill(9)) } }),
    )

    await signingService.initialize()

    expect(storage.getItem('beforeai.device.v2')).toBeNull()
    expect(deviceStore.get('user-a').keyMigrationStatus).toBe('NEEDS_REENROLLMENT')
    expect(await signingService.hasDeviceKey('user-a')).toBe(false)
  })
})
