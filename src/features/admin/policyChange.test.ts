import { MutationObserver, QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/errors'
import { toast } from '../../components/toast'
import { policyAdminProof } from '../../crypto/adminProof'
import { deviceStore } from '../../crypto/deviceStore'
import { onPolicyError } from './policyChange'

vi.mock('../../components/toast', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }))

beforeEach(() => {
  vi.clearAllMocks()
  deviceStore.clear()
})

describe('정책 변경 실패 안내', () => {
  it('키 없는 관리자가 규칙 추가·프리셋·폐기를 누르면 보내지 않고 토스트로 알린다', async () => {
    const send = vi.fn()
    const committed = vi.fn()
    // 화면의 mutationFn과 같다: 본문을 만들다가 서명 값에서 멈춘다.
    const observer = new MutationObserver<unknown, Error, void>(new QueryClient(), {
      mutationFn: () => send({ adminProof: policyAdminProof('admin') }),
      onError: onPolicyError(committed),
    })
    await observer.mutate().catch(() => {})
    expect(send).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('이 기기에 관리자 승인 키가 없습니다. 내 정보에서 키를 만들어 주세요')
    expect(committed).not.toHaveBeenCalled()
  })

  it('웹쉘 배포만 실패한 502는 저장된 것으로 보고 닫는다', () => {
    const committed = vi.fn()
    onPolicyError(committed)(new ApiError(502, 'WEBSHELL_UNAVAILABLE', 'x', { mutationCommitted: true }))
    expect(toast.info).toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(committed).toHaveBeenCalledOnce()
  })
})
