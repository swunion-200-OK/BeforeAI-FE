/** 변조 시연의 공격 결과 문장. 실제 확인 결과로만 "막혔다"고 말하고, 방어가 돌지 않았으면 그대로 알린다. */
import type { ApprovalContext, FailedCheck, RequestDetail, RequestStatus } from '../../api/types'
import type { TamperAttack } from '../../api/mock/store'
import { REQUEST_STATUS_LABEL } from '../../lib/labels'
import type { IntegrityResult } from '../approvals/approvalFlow'

/** caught: 방어가 막음, waiting: 승인자 서명을 기다림, missed: 방어가 돌았는데 통과시킴, unverified: 그 방어가 판단한 적이 없음 */
export type OutcomeTone = 'caught' | 'waiting' | 'missed' | 'unverified'

export interface TamperOutcome {
  tone: OutcomeTone
  sentence: string
  /** 웹쉘이 돌려준 실패 항목 코드 */
  codes?: string[]
}

export interface OutcomeEvidence {
  request: Pick<RequestDetail, 'status' | 'failedChecks' | 'approvalRecordCount'>
  /** 승인 자료를 아직 받지 못했으면 없다 */
  context?: Pick<ApprovalContext, 'plan' | 'hashTarget'>
  integrity?: Pick<IntegrityResult, 'hashOk' | 'displayOk' | 'ok'>
  /** 승인 자료를 받지 못해 승인자 기기의 확인을 돌릴 수 없다 */
  contextFailed?: boolean
}

/** 웹쉘 검증을 통과해야만 갈 수 있는 상태. 이때만 웹쉘이 공격을 놓쳤다고 말할 수 있다. */
const PASSED_WEBSHELL: RequestStatus[] = [
  'RUNNING',
  'KILLED',
  'COMPLETED',
  'PARTIALLY_COMPLETED',
  'FAILED',
  'ROLLING_BACK',
  'ROLLED_BACK',
  'ROLLBACK_FAILED',
]

type Request = OutcomeEvidence['request']

const missed = (request: Request, what: string): TamperOutcome => ({
  tone: 'missed',
  sentence: `방어가 작동하지 않았습니다. ${what}. 요청은 지금 ${REQUEST_STATUS_LABEL[request.status]} 상태입니다.`,
})

const notReached = (request: Request, lead = '웹쉘 검증까지 가지 않았습니다'): TamperOutcome => ({
  tone: 'unverified',
  sentence: `${lead}. 요청은 지금 ${REQUEST_STATUS_LABEL[request.status]} 상태입니다.`,
})

const contextMissing: TamperOutcome = {
  tone: 'unverified',
  sentence: '승인 자료를 받지 못해 승인자 기기의 확인을 돌리지 못했습니다.',
}

/** 웹쉘이 판단한 뒤의 결과만 다룬다. 판단한 적이 없으면 null이다. */
function webshellVerdict(request: Request, expected: FailedCheck, caught: string, passed: string): TamperOutcome | null {
  if (PASSED_WEBSHELL.includes(request.status)) return missed(request, passed)
  if (request.status !== 'VERIFICATION_FAILED') return null
  if (request.failedChecks.includes(expected)) return { tone: 'caught', sentence: caught, codes: request.failedChecks }
  // 다른 이유로 먼저 멈췄으면 이 공격을 찾아냈는지 알 수 없다. 막았다고도 놓쳤다고도 하지 않는다.
  return {
    tone: 'unverified',
    sentence: '웹쉘이 실행을 거부했지만 이 공격을 찾아낸 것은 아닙니다. 다른 항목에서 실패했습니다.',
    codes: request.failedChecks,
  }
}

export function describeOutcome(attack: TamperAttack, evidence: OutcomeEvidence): TamperOutcome | null {
  const { request, context, integrity, contextFailed } = evidence

  switch (attack) {
    case 'SWAP_BEFORE_SIGN':
      if (!integrity) return contextFailed ? contextMissing : null
      if (!integrity.hashOk) {
        return {
          tone: 'caught',
          sentence: '승인자 기기가 받은 내용으로 해시를 직접 계산해 보니 웹 서비스가 보낸 해시와 달라 서명을 잠갔습니다.',
        }
      }
      return missed(request, '승인자 기기의 해시 확인을 통과했습니다')

    case 'SWAP_DISPLAY': {
      if (!integrity || !context) return contextFailed ? contextMissing : null
      if (!integrity.displayOk) {
        const shown = context.plan.tasks[0]?.target
        const signed = context.hashTarget.tasks[0]?.target
        return {
          tone: 'caught',
          sentence:
            shown !== signed
              ? `화면의 배포 대상(${shown})과 실제 서명 대상(${signed})이 달라 승인자 기기가 서명을 잠갔습니다.`
              : '화면의 Plan과 실제 서명 대상이 달라 승인자 기기가 서명을 잠갔습니다.',
        }
      }
      return missed(request, '화면과 서명 대상이 같다고 확인했습니다')
    }

    case 'SWAP_AFTER_SIGN': {
      const verdict = webshellVerdict(
        request,
        'PLAN_HASH_MISMATCH',
        '웹쉘이 실행 직전에 해시를 다시 계산해 보니 승인자가 서명한 해시와 달라 실행을 거부했습니다.',
        '웹쉘이 서명 뒤에 바뀐 Plan을 통과시켰습니다',
      )
      if (verdict) return verdict
      if (request.status !== 'PENDING_APPROVAL') return notReached(request)
      if ((request.approvalRecordCount ?? 0) > 0) return notReached(request, '서명은 제출됐지만 아직 웹쉘 검증까지 가지 않았습니다')
      if (!integrity) return contextFailed ? contextMissing : null
      return integrity.ok
        ? { tone: 'waiting', sentence: '지금은 아무것도 바뀌지 않았으니 오른쪽에서 승인(서명)을 누르세요.' }
        : notReached(request, '승인자 기기에서 서명할 수 없어 웹쉘 검증까지 가지 않았습니다')
    }

    case 'FORGE_APPROVAL':
      return (
        webshellVerdict(
          request,
          'MISSING_REQUIRED_APPROVER',
          '웹쉘은 웹 서비스의 승인 기록을 믿지 않고 서명만 확인해, 필요한 승인권자의 서명이 없어 실행을 거부했습니다.',
          '웹쉘이 서명 없는 승인을 통과시켰습니다',
        ) ?? notReached(request)
      )
  }
}
