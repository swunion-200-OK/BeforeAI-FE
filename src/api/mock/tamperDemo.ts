/**
 * 변조 시연용 공격. 웹 서비스가 뚫렸다고 가정하고 저장소를 실제로 바꾼다.
 * 막는 쪽(승인자 기기의 verifyIntegrity, 웹쉘의 verifyExecution)은 평소 코드 그대로이고, 여기서 결과를 정하지 않는다.
 * 시드에 넣지 않고 시연 화면을 떠나면 지우므로, 다른 화면의 승인 대기 목록과 집계에는 남지 않는다.
 */
import { hashService, toHashTarget } from '../../crypto/hashService'
import type { Plan, TaskContent } from '../types'
import { addRequest, deployTask } from './seed'
import { db, nextId, nowIso, persist, type StoredRequest, type TamperAttack } from './store'
import { requestExecution } from './webshell'

export const TAMPER_DEMO_PATH = '/demo/tamper'
const ID_PREFIX = 'r-tamper'
const PROMPT = '인증 서비스를 스테이징에 배포해줘'
const APPROVER = { id: 'u-07', name: '김담당' }
const PRODUCTION: { target: string; content: TaskContent } = {
  target: 'production',
  content: { command: './deploy.sh production --force' },
}

function currentRequest(): StoredRequest | undefined {
  return db().requests.find((request) => request.id.startsWith(`${ID_PREFIX}-`))
}

function create(): StoredRequest {
  return addRequest({
    id: nextId(ID_PREFIX),
    requesterId: 'u-01',
    prompt: PROMPT,
    status: 'PENDING_APPROVAL',
    ageMinutes: 2,
    tasks: [{ ...deployTask('PENDING'), title: '인증 서비스 스테이징 배포' }],
  })
}

/** 지난 시연의 흔적을 지운다. 다른 요청과 웹쉘의 1회용 ID 기록은 건드리지 않는다. */
function remove(requestId: string) {
  const database = db()
  database.requests = database.requests.filter((request) => request.id !== requestId)
  delete database.logs[requestId]
  delete database.webshell.sessions[requestId]
  database.auditLogs = database.auditLogs.filter((log) => log.target.requestId !== requestId)
  database.slackOutbox = database.slackOutbox.filter((message) => message.link !== `/requests/${requestId}`)
}

/** 아직 아무 일도 없었던 시연 요청에만 공격할 수 있다. 공격을 겹치면 어느 방어가 막았는지 알 수 없다. */
function attackable(requestId: string): StoredRequest & { plan: Plan } {
  const request = db().requests.find((r) => r.id === requestId)
  if (!request?.plan || request.status !== 'PENDING_APPROVAL' || request.approvals.length > 0 || request.tamperAttack) {
    throw new Error('처음부터 다시 시작한 뒤에 공격할 수 있습니다')
  }
  return request as StoredRequest & { plan: Plan }
}

function recordAttack(request: StoredRequest, attack: TamperAttack) {
  request.tamperAttack = attack
  // 승인 화면은 요청이 바뀐 시각을 보고 승인 자료를 다시 받는다.
  request.updatedAt = nowIso()
  persist()
}

export const tamperDemo = {
  currentId(): string | null {
    return currentRequest()?.id ?? null
  },
  attackOf(requestId: string | null): TamperAttack | null {
    return db().requests.find((request) => request.id === requestId)?.tamperAttack ?? null
  },
  /** 시연 요청이 없으면 만든다. 데이터 초기화로 사라져도 여기서 다시 생긴다. */
  ensure(): string {
    const existing = currentRequest()
    if (existing) return existing.id
    const created = create()
    persist()
    return created.id
  },
  /** 시연 요청만 새것으로 바꾼다. id가 바뀌므로 승인 화면의 상태도 함께 처음으로 돌아간다. */
  reset(): string {
    const existing = currentRequest()
    if (existing) remove(existing.id)
    const created = create()
    persist()
    return created.id
  },
  /**
   * 지금 경로가 시연 화면도, 그 요청의 상세 화면도 아니면 시연 요청을 지운다.
   * 승인 화면의 "실패 항목 보기"로 상세를 보는 동안에는 남겨 둔다. 지웠으면 true를 돌려준다.
   */
  sweep(pathname: string): boolean {
    const request = currentRequest()
    if (!request || pathname === TAMPER_DEMO_PATH || pathname.includes(request.id)) return false
    remove(request.id)
    persist()
    return true
  },
  /** 공격 1: 내용만 production으로 바꾸고 해시는 그대로 둔다. */
  swapBeforeSigning(requestId: string) {
    const request = attackable(requestId)
    const [task] = request.plan.tasks
    task.target = PRODUCTION.target
    task.content = PRODUCTION.content
    recordAttack(request, 'SWAP_BEFORE_SIGN')
  },
  /** 공격 2: 서명 대상과 해시는 production으로 맞추고, 화면에 보이는 Plan만 스테이징으로 남긴다. */
  swapDisplayOnly(requestId: string) {
    const request = attackable(requestId)
    const forged = toHashTarget(request.plan)
    forged.tasks[0] = { ...forged.tasks[0], ...PRODUCTION }
    request.forgedHashTarget = forged
    request.plan.planHash = hashService.computeTargetHash(forged)
    recordAttack(request, 'SWAP_DISPLAY')
  },
  /**
   * 공격 3: 걸어 두면 서명이 제출된 뒤 웹쉘 검증 직전에 Plan이 바뀐다 (webshell.ts requestExecution).
   * production은 금지 규칙에도 걸리므로, 해시 확인만 막을 수 있는 강제 배포로 바꾼다.
   */
  armSwapAfterSigning(requestId: string) {
    const request = attackable(requestId)
    request.armedPlanSwap = { taskId: request.plan.tasks[0].id, target: 'staging', content: { command: './deploy.sh staging --force' } }
    recordAttack(request, 'SWAP_AFTER_SIGN')
  },
  /** 공격 4: 서명 없이 승인 기록만 적고 실행을 요청한다. 결재란에는 도장이 보이지만 웹쉘은 평문 기록을 보지 않는다. */
  forgeApproval(requestId: string) {
    const request = attackable(requestId)
    for (const task of request.plan.tasks) {
      for (const requirement of task.requiredApprovers) {
        request.approvals.push({
          planId: request.plan.id,
          taskId: task.id,
          rule: requirement.rule,
          userId: APPROVER.id,
          name: APPROVER.name,
          network: 'INTERNAL',
          at: nowIso(),
          self: false,
        })
      }
      task.status = 'APPROVED'
    }
    requestExecution(request)
    recordAttack(request, 'FORGE_APPROVAL')
  },
}
