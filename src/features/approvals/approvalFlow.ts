/** 승인 서명 흐름 (명세 2.4, 4.3~4.5). 승인 상세와 제출 직후 본인 승인이 같은 코드를 쓴다. */
import { approvalsApi, requestsApi } from '../../api/endpoints'
import { ApiError, errorMessage } from '../../api/errors'
import type { ApprovalContext, ApprovalEnvelope, Me, SubmitApprovalResponse, SubmitResponse, Task } from '../../api/types'
import { cryptoService } from '../../crypto/cryptoService'
import { deviceStore } from '../../crypto/deviceStore'
import { hashService } from '../../crypto/hashService'
import { randomUuid } from '../../crypto/randomUuid'
import { signingService } from '../../crypto/signingService'

export interface IntegrityResult {
  computedHash: string
  /** hashTarget으로 직접 계산한 해시가 planHash와 같음 */
  hashOk: boolean
  /** 화면에 보여 줄 Plan과 hashTarget의 내용이 같음 */
  displayOk: boolean
  /** 고정해 둔 웹쉘 공개키가 없음. 암호화할 수 없어 서명하지 않는다 */
  keyMissing: boolean
  ok: boolean
}

/**
 * 서명 전 확인 (명세 4.4): 해시를 직접 다시 계산해 planHash와 같고, 화면의 Plan과 hashTarget의 내용이 같아야 한다.
 * 프로젝트 이름은 요청 상세에서 받아 화면에 보여 주므로 shownProjectId로 그 프로젝트도 비교한다.
 */
export function verifyIntegrity(context: ApprovalContext, userId: string, shownProjectId?: string): IntegrityResult {
  const computedHash = hashService.computeTargetHash(context.hashTarget)
  const hashOk = computedHash === context.planHash
  const displayOk =
    context.hashTarget.requestId === context.requestId &&
    (shownProjectId === undefined || context.hashTarget.projectId === shownProjectId) &&
    hashService.matchesHashTarget(context.plan, context.hashTarget)
  const keyMissing = !deviceStore.get(userId).pinnedWebshellKey
  return { computedHash, hashOk, displayOk, keyMissing, ok: hashOk && displayOk && !keyMissing }
}

export type SignStep = 'hash' | 'sign' | 'encrypt' | 'submit'
export const SIGN_STEPS: Array<{ id: SignStep; label: string }> = [
  { id: 'hash', label: '해시 확인' },
  { id: 'sign', label: '서명' },
  { id: 'encrypt', label: '암호화' },
  { id: 'submit', label: '제출' },
]

/**
 * 제출 버튼 하나로 서명까지 끝내도 되는 작업. 사람이 따로 본 적 없는 서명을 만들지 않도록 좁게 잡는다.
 * 서버의 selfApprovableTaskIds는 후보이면 위험도와 상관없이 담으므로(RequestPlanService.selfApprovableTaskIds) 그대로 쓰지 않는다.
 * 문서는 완성본을 보고 적용 여부를 정해야 해서 뺀다 (기능 명세서 5.4).
 */
export function isSelfApprovable(task: Task): boolean {
  return (
    task.type !== 'DOC' &&
    (task.risk === 'LOW' || task.risk === 'MEDIUM') &&
    task.requiredApprovers.every((requirement) => requirement.rule === 'ANYONE')
  )
}

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
  /** 화면에 보여 준 프로젝트. 서명 대상의 프로젝트와 같아야 한다 */
  shownProjectId?: string
  onStep?: (step: SignStep) => void | Promise<void>
}

/** 해시 확인 → 기기 키 서명 → 고정해 둔 웹쉘 공개키로 암호화 → 제출 */
export async function signAndSubmitApproval({
  me,
  context,
  taskIds,
  shownProjectId,
  onStep,
}: SignOptions): Promise<SubmitApprovalResponse> {
  await onStep?.('hash')
  const integrity = verifyIntegrity(context, me.id, shownProjectId)
  if (!integrity.ok) throw new IntegrityError()
  // 해시 대상에 없는 작업(금지 작업 등)은 서명에 담지 않는다.
  const signable = new Set(context.hashTarget.tasks.map((task) => task.id))
  if (taskIds.length === 0 || taskIds.some((id) => !signable.has(id))) throw new IntegrityError()
  // 서버의 승인 API는 내부망 전용이다 (ApprovalController). 어차피 거절될 서명을 만들지 않고 여기서 멈춘다.
  if (context.network === 'EXTERNAL') {
    throw new ApiError(403, 'INTERNAL_NETWORK_ONLY', '승인 서명은 내부망에서만 제출할 수 있습니다')
  }

  const device = deviceStore.get(me.id)
  if (!device.secretKey || !device.keyId || !device.pinnedWebshellKey) {
    throw new Error('이 기기에 승인 키가 없습니다. 내 정보에서 승인 키를 등록해 주세요')
  }

  await onStep?.('sign')
  const signed = signingService.sign(me.id, {
    planHash: integrity.computedHash,
    requestId: context.requestId,
    planId: context.plan.id,
    taskIds,
    approverId: me.id,
    keyId: device.keyId,
    issuedAt: new Date().toISOString(),
    nonce: randomUuid(),
    network: context.network,
  })

  await onStep?.('encrypt')
  let envelope: ApprovalEnvelope
  try {
    envelope = cryptoService.encryptForWebshell(signed, device.pinnedWebshellKey.encryption.publicKey)
  } catch (error) {
    // 웹쉘이 열 수 없는 봉투를 보내지 않도록 제출 전에 멈춘다.
    throw new Error(`승인을 암호화하지 못해 제출하지 않았습니다. ${errorMessage(error)}`, { cause: error })
  }

  await onStep?.('submit')
  return approvalsApi.submit(context.requestId, {
    planId: context.plan.id,
    planHash: integrity.computedHash,
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
  /** 승인은 다 모였지만 웹쉘에 연결할 수 없어 실행을 시작하지 못했다. 서명은 저장되어 있다 */
  executionDeferred: boolean
  /** 본인 승인을 못 했을 때의 이유. 제출 자체는 끝난 상태다. */
  selfApprovalError: string | null
  /** 이 기기에 승인 키가 없어 본인 승인을 시도하지 않았다. 오류가 아니다. */
  selfApprovalSkipped: boolean
}

/** 사용자가 화면에서 본 프로젝트와 작업 */
export interface ReviewedPlan {
  projectId: string
  tasks: Task[]
}

/** 본인 승인은 승인 화면 없이 바로 서명하므로, 제출 전에 사용자가 본 Plan과 서명할 내용이 같은지 본다. */
function matchesReviewed(context: ApprovalContext, reviewed: ReviewedPlan | null): reviewed is ReviewedPlan {
  const target = context.hashTarget
  return (
    reviewed !== null &&
    reviewed.projectId === target.projectId &&
    hashService.matchesHashTarget({ id: target.planId, tasks: reviewed.tasks }, target)
  )
}

/**
 * 제출(1차 확인). 본인 승인이 허용된 작업은 응답을 받은 뒤 바로 승인까지 끝낸다.
 * 이미 받은 SubmitResponse가 있으면 submitted로 넘긴다.
 */
export async function submitWithSelfApproval(
  me: Pick<Me, 'id' | 'network'>,
  requestId: string,
  reviewed: ReviewedPlan | null,
  submitted?: SubmitResponse,
): Promise<SubmitOutcome> {
  const submit = submitted ?? (await requestsApi.submit(requestId))
  const outcome: SubmitOutcome = {
    submit,
    selfApprovedTaskIds: [],
    executionRequested: false,
    executionDeferred: false,
    selfApprovalError: null,
    selfApprovalSkipped: false,
  }
  if (submit.selfApprovableTaskIds.length === 0) return outcome
  try {
    const context = await approvalsApi.context(requestId)
    const allowed = new Set(context.plan.tasks.filter((task) => task.status === 'PENDING' && isSelfApprovable(task)).map((task) => task.id))
    const taskIds = submit.selfApprovableTaskIds.filter((id) => context.approvableTaskIds.includes(id) && allowed.has(id))
    if (taskIds.length === 0) return outcome
    if (!matchesReviewed(context, reviewed)) {
      outcome.selfApprovalError = '검토한 Plan과 서명할 내용이 달라 서명하지 않았습니다'
      return outcome
    }
    const device = deviceStore.get(me.id)
    if (!device.secretKey || !device.keyId || !device.pinnedWebshellKey) {
      outcome.selfApprovalSkipped = true
      return outcome
    }
    const result = await signAndSubmitApproval({ me, context, taskIds, shownProjectId: reviewed.projectId })
    outcome.selfApprovedTaskIds = taskIds
    outcome.executionRequested = result.executionRequested
    outcome.executionDeferred = !result.executionRequested && result.remainingTaskIds.length === 0
  } catch (error) {
    outcome.selfApprovalError = error instanceof Error ? error.message : '본인 승인을 하지 못했습니다'
  }
  return outcome
}
