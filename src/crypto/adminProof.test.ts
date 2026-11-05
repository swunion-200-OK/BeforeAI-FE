import { beforeEach, describe, expect, it } from 'vitest'
import { UNSIGNED_POLICY_NOTICE, UNSIGNED_POLICY_SIGNATURE, adminKeyMissingReason, policyAdminProof, revokeAdminProof } from './adminProof'
import { deviceStore } from './deviceStore'

beforeEach(() => {
  deviceStore.clear()
})

describe('정책 변경 관리자 서명 자리 표시', () => {
  it('이 기기의 키 ID와, 서명이 아니라고 알아볼 수 있는 값을 보낸다', () => {
    deviceStore.update('admin', { keyId: 'key-1', secretKey: 'c2VjcmV0' })
    expect(policyAdminProof('admin')).toEqual({ keyId: 'key-1', signature: UNSIGNED_POLICY_SIGNATURE })
    expect(UNSIGNED_POLICY_SIGNATURE).toContain('UNSIGNED')
  })

  it('이 기기에 키가 없으면 키 ID를 지어내지 않고 멈춘다', () => {
    expect(() => policyAdminProof('admin')).toThrow('이 기기에 관리자 승인 키가 없습니다')
  })
})

describe('키가 없을 때의 사전 안내', () => {
  it('누르기 전에 키가 없다고 알 수 있다', () => {
    expect(adminKeyMissingReason('admin')).toContain('이 기기에 관리자 승인 키가 없습니다')
    deviceStore.update('admin', { keyId: 'key-1' })
    expect(adminKeyMissingReason('admin')).toBeNull()
  })

  it('안내문이 실제 동작과 맞다: 키는 필요하고 서명은 아니다', () => {
    expect(UNSIGNED_POLICY_NOTICE).toContain('키 ID')
    expect(UNSIGNED_POLICY_NOTICE).toContain('실제 서명은 붙지 않습니다')
  })
})

describe('키 폐기 관리자 서명', () => {
  it('등록된 키는 정책 변경과 같은 자리 표시 값을 보낸다', () => {
    deviceStore.update('admin', { keyId: 'key-1', secretKey: 'c2VjcmV0' })
    expect(revokeAdminProof('REGISTERED', 'admin')).toEqual({ keyId: 'key-1', signature: UNSIGNED_POLICY_SIGNATURE })
  })

  it('등록된 키인데 이 기기에 키가 없으면 보내기 전에 멈춘다', () => {
    expect(() => revokeAdminProof('REGISTERED', 'admin')).toThrow('이 기기에 관리자 승인 키가 없습니다')
  })

  it('등록 대기 키는 이 기기에 키가 없어도 본문 없이 폐기한다', () => {
    expect(revokeAdminProof('PENDING', 'admin')).toBeUndefined()
  })
})

describe('시연 데이터의 관리자', () => {
  it('처음부터 이 기기에 승인 키가 있어 정책·금지 작업 변경이 막히지 않는다', async () => {
    const { initMock } = await import('../api/mock')
    const { buildSeed } = await import('../api/mock/seed')
    initMock()
    buildSeed()
    expect(policyAdminProof('u-admin').keyId).toBe('k-admin-a')
  })
})
