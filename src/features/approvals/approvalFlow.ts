/** 승인 서명 흐름 (명세 2.4, 4.3~4.5). 승인 상세와 제출 직후 본인 승인이 같은 코드를 쓴다. */
import { approvalsApi, requestsApi } from '../../api/endpoints'
import type { ApprovalContext, Me, SubmitApprovalResponse, SubmitResponse } from '../../api/types'
import { cryptoService } from '../../crypto/cryptoService'
import { deviceStore } from '../../crypto/deviceStore'
import { hashService } from '../../crypto/hashService'
import { signingService } from '../../crypto/signingService'

export interface IntegrityResult {
  computedHash: string
  hashOk: boolean
  signatureOk: boolean
  /** 고정해 둔 실행기 공개키가 없음 */
  keyMissing: boolean
  ok: boolean
}

/** 받은 Plan으로 해시를 직접 다시 계산하고, 실행기 서명을 고정한 공개키로 확인한다. */
export function verifyIntegrity(context: ApprovalContext, userId: string): IntegrityResult {
  const computedHash = hashService.computePlanHash(context.plan)
  const hashOk = computedHash === context.planHash
  const pinned = deviceStore.get(userId).pinnedExecutorKey
  const signatureOk = pinned
    ? signingService.verifyExecutorSignature(context.planHash, context.executorSignature, pinned)
    : false
  return { computedHash, hashOk, signatureOk, keyMissing: !pinned, ok: hashOk && signatureOk }
}

export type SignStep = 'hash' | 'sign' | 'encrypt' | 'submit'
export const SIGN_STEPS: Array<{ id: SignStep; label: string }> = [
  { id: 'hash', label: '해시 확인' },
  { id: 'sign', label: '서명' },
  { id: 'encrypt', label: '암호화' },
  { id: 'submit', label: '제출' },
]

export class IntegrityError extends Error {
  constructor() {
    super('Plan 무결성 확인 실패')
    this.name = 'IntegrityError'
  }
}

interface SignOptions {
  me: Pick<Me, 'id' | 'network'>
  context: ApprovalContext
  taskIds: string[]
  onStep?: (step: SignStep) => void | Promise<void>
}

/** 해시 확인 → 기기 키 서명 → 실행기 공개키로 암호화 → 제출 */
export async function signAndSubmitApproval({
  me,
  context,
  taskIds,
  onStep,
}: SignOptions): Promise<SubmitApprovalResponse> {
  await onStep?.('hash')
  if (!verifyIntegrity(context, me.id).ok) throw new IntegrityError()

  const device = deviceStore.get(me.id)
  if (!device.secretKey || !device.keyId || !device.pinnedExecutorKey) {
    throw new Error('이 기기에 승인 키가 없습니다. 내 정보에서 승인 키를 등록해 주세요')
  }

  await onStep?.('sign')
  const signed = signingService.sign(me.id, {
    planHash: context.planHash,
    requestId: context.requestId,
    planId: context.plan.id,
    taskIds,
    approverId: me.id,
    keyId: device.keyId,
    issuedAt: new Date().toISOString(),
    nonce: crypto.randomUUID(),
    network: context.network,
  })

  await onStep?.('encrypt')
  const envelope = cryptoService.encryptForExecutor(signed, device.pinnedExecutorKey)

  await onStep?.('submit')
  return approvalsApi.submit(context.requestId, {
    planId: context.plan.id,
    planHash: context.planHash,
    taskIds,
    keyId: device.keyId,
    envelope,
  })
}

export interface SubmitOutcome {
  submit: SubmitResponse
  /** 제출과 함께 본인 승인이 끝난 작업 */
  selfApprovedTaskIds: string[]
  executionRequested: boolean
  /** 본인 승인을 못 했을 때의 이유. 제출 자체는 끝난 상태다. */
  selfApprovalError: string | null
}

/**
 * 제출(1차 확인). 본인 승인이 허용된 작업은 응답을 받은 뒤 바로 승인까지 끝낸다.
 * 재시도·재제출처럼 이미 받은 SubmitResponse가 있으면 submitted로 넘긴다.
 */
export async function submitWithSelfApproval(
  me: Pick<Me, 'id' | 'network'>,
  requestId: string,
  submitted?: SubmitResponse,
): Promise<SubmitOutcome> {
  const submit = submitted ?? (await requestsApi.submit(requestId))
  const outcome: SubmitOutcome = {
    submit,
    selfApprovedTaskIds: [],
    executionRequested: false,
    selfApprovalError: null,
  }
  if (submit.selfApprovableTaskIds.length === 0) return outcome
  try {
    const context = await approvalsApi.context(requestId)
    const taskIds = submit.selfApprovableTaskIds.filter((id) => context.approvableTaskIds.includes(id))
    if (taskIds.length === 0) return outcome
    const result = await signAndSubmitApproval({ me, context, taskIds })
    outcome.selfApprovedTaskIds = taskIds
    outcome.executionRequested = result.executionRequested
  } catch (error) {
    outcome.selfApprovalError = error instanceof Error ? error.message : '본인 승인을 하지 못했습니다'
  }
  return outcome
}
