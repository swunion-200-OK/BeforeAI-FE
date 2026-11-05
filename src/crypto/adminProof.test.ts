import { beforeEach, describe, expect, it } from 'vitest'
import { UNSIGNED_POLICY_SIGNATURE, policyAdminProof } from './adminProof'
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
