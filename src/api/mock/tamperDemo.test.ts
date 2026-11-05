import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAccessToken, setTransport } from '../client'
import { approvalsApi, meApi, requestsApi } from '../endpoints'
import { deviceStore } from '../../crypto/deviceStore'
import { toHashTarget } from '../../crypto/hashService'
import { IntegrityError, signAndSubmitApproval, verifyIntegrity } from '../../features/approvals/approvalFlow'
import { describeOutcome } from '../../features/demo/tamperOutcome'
import { devControls, initMock, mockFetch } from './index'
import { buildSeed } from './seed'
import { db, mockConfig } from './store'
import { verifyExecution } from './webshell'

class MemoryStorage {
  private map = new Map<string, string>()
  getItem = (key: string) => this.map.get(key) ?? null
  setItem = (key: string, value: string) => void this.map.set(key, value)
  removeItem = (key: string) => void this.map.delete(key)
}

const { tamper } = devControls
const stored = (id: string) => db().requests.find((request) => request.id === id)!

function approver() {
  devControls.setNetwork('INTERNAL')
  setAccessToken(devControls.switchUser('u-07'))
}

async function evidence(requestId: string) {
  const request = await requestsApi.get(requestId)
  const context = await approvalsApi.context(requestId)
  const integrity = verifyIntegrity(context, 'u-07', request.projectId)
  return { request, context, integrity }
}

const sign = async (requestId: string) => {
  const context = await approvalsApi.context(requestId)
  return signAndSubmitApproval({ me: await meApi.get(), context, taskIds: ['t-1'] })
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
  mockConfig.latencyMs = 0
  mockConfig.execStepMs = 1
  mockConfig.webshellReachable = true
  mockConfig.webshellRetryMs = 5000
  setTransport(mockFetch)
  initMock()
  deviceStore.clear()
  buildSeed()
  approver()
})

afterEach(() => {
  setAccessToken(null)
  vi.unstubAllGlobals()
})

describe('변조 시연', () => {
  it('시드에는 시연 요청이 없다', () => {
    expect(tamper.currentId()).toBeNull()
  })

  it('공격하지 않으면 같은 요청이 모든 확인을 통과해 실행된다', async () => {
    const id = tamper.ensure()
    const { integrity } = await evidence(id)
    expect(integrity.ok).toBe(true)
    const result = await sign(id)
    expect(result.status).toBe('RUNNING')
    expect(stored(id).failedChecks).toEqual([])
  })

  it('공격 1: 해시를 그대로 두고 대상을 바꾸면 승인자 기기의 해시 확인이 서명을 막는다', async () => {
    const id = tamper.ensure()
    tamper.swapBeforeSigning(id)
    const found = await evidence(id)
    expect(found.context.hashTarget.tasks[0].target).toBe('production')
    expect(found.integrity).toMatchObject({ hashOk: false, displayOk: true, ok: false })
    await expect(sign(id)).rejects.toBeInstanceOf(IntegrityError)
    expect(stored(id).approvalRecords).toEqual([])
    expect(stored(id).status).toBe('PENDING_APPROVAL')
    expect(describeOutcome('SWAP_BEFORE_SIGN', found)?.tone).toBe('caught')
  })

  it('공격 2: 화면의 Plan만 다르면 승인자 기기의 화면 내용 확인이 서명을 막는다', async () => {
    const id = tamper.ensure()
    tamper.swapDisplayOnly(id)
    const found = await evidence(id)
    expect(found.context.plan.tasks[0].target).toBe('staging')
    expect(found.context.hashTarget.tasks[0].target).toBe('production')
    expect(found.integrity).toMatchObject({ hashOk: true, displayOk: false, ok: false })
    await expect(sign(id)).rejects.toBeInstanceOf(IntegrityError)
    expect(stored(id).approvalRecords).toEqual([])
    const outcome = describeOutcome('SWAP_DISPLAY', found)
    expect(outcome?.tone).toBe('caught')
    expect(outcome?.sentence).toContain('staging')
    expect(outcome?.sentence).toContain('production')
  })

  it('공격 3: 걸어 둔 동안에는 서명할 수 있고, 서명 뒤 바꿔치기는 웹쉘이 PLAN_HASH_MISMATCH로 막는다', async () => {
    const id = tamper.ensure()
    tamper.armSwapAfterSigning(id)
    const before = await evidence(id)
    expect(before.integrity.ok).toBe(true)
    expect(before.context.hashTarget.tasks[0].target).toBe('staging')
    expect(describeOutcome('SWAP_AFTER_SIGN', before)?.tone).toBe('waiting')

    const result = await sign(id)
    expect(result).toMatchObject({ status: 'VERIFICATION_FAILED', executionRequested: true })

    const request = stored(id)
    expect(request.failedChecks).toEqual(['PLAN_HASH_MISMATCH'])
    expect(request.plan!.tasks[0].content.command).toBe('./deploy.sh staging --force')
    expect(request.armedPlanSwap).toBeUndefined()
    // 서명은 실제로 제출됐고, 1회용 ID는 소진되지 않았으며 아무것도 실행되지 않았다.
    expect(request.approvalRecords).toHaveLength(1)
    expect(db().webshell.usedNonces).toEqual([])
    expect(db().logs[id]).toBeUndefined()
    // 저장된 기록을 웹쉘 검증에 다시 넣어도 같은 이유로 실패한다.
    const again = verifyExecution(
      { plan: toHashTarget(request.plan!, request.projectId), approvals: request.approvalRecords.map(({ keyId, envelope }) => ({ keyId, envelope })) },
      request,
    )
    expect(again.failed).toContain('PLAN_HASH_MISMATCH')
    const detail = await requestsApi.get(id)
    expect(describeOutcome('SWAP_AFTER_SIGN', { request: detail })?.tone).toBe('caught')
  })

  it('공격 4: 서명 없이 승인 기록만 지어내면 웹쉘이 MISSING_REQUIRED_APPROVER로 막는다', async () => {
    const id = tamper.ensure()
    tamper.forgeApproval(id)
    const request = stored(id)
    expect(request.approvals.map((approval) => approval.name)).toEqual(['김담당'])
    expect(request.approvalRecords).toEqual([])
    expect(request.status).toBe('VERIFICATION_FAILED')
    expect(request.failedChecks).toEqual(['MISSING_REQUIRED_APPROVER'])
    expect(db().webshell.usedNonces).toEqual([])
    const detail = await requestsApi.get(id)
    expect(describeOutcome('FORGE_APPROVAL', { request: detail })?.tone).toBe('caught')
  })

  describe('결과 문장은 실제로 돈 확인만 말한다', () => {
    const passed = { hashOk: true, displayOk: true, ok: true }
    const pending = { status: 'PENDING_APPROVAL' as const, failedChecks: [], approvalRecordCount: 0 }
    const context = () => ({ plan: { ...stored('r-main').plan!, id: 'p' }, hashTarget: toHashTarget(stored('r-main').plan!, stored('r-main').projectId) })
    const toneOf = async (attack: Parameters<typeof describeOutcome>[0], id: string) => {
      const { request, context: ctx, integrity } = await evidence(id)
      return describeOutcome(attack, { request, context: ctx, integrity })
    }

    it('공격 1·2: 승인자 기기 확인이 돌아 통과했을 때만 놓쳤다고 한다', () => {
      expect(describeOutcome('SWAP_BEFORE_SIGN', { request: pending, context: context(), integrity: passed })?.tone).toBe('missed')
      expect(describeOutcome('SWAP_DISPLAY', { request: pending, context: context(), integrity: passed })?.tone).toBe('missed')
    })

    it('공격 1·2: 승인 자료를 기다리면 판단하지 않고, 받지 못했으면 돌리지 못했다고 한다', () => {
      expect(describeOutcome('SWAP_BEFORE_SIGN', { request: pending })).toBeNull()
      expect(describeOutcome('SWAP_DISPLAY', { request: pending })).toBeNull()
      expect(describeOutcome('SWAP_BEFORE_SIGN', { request: pending, contextFailed: true })?.tone).toBe('unverified')
      expect(describeOutcome('SWAP_DISPLAY', { request: pending, contextFailed: true })?.tone).toBe('unverified')
    })

    it('공격 1·2 뒤에 거부해도 이미 돈 기기 확인 결과는 그대로다', async () => {
      const id = tamper.ensure()
      tamper.swapBeforeSigning(id)
      await approvalsApi.reject(id, { planId: stored(id).plan!.id, taskIds: ['t-1'], reason: '이상함' })
      expect((await toneOf('SWAP_BEFORE_SIGN', id))?.tone).toBe('caught')
    })

    it('공격 2: 배포 대상이 같으면 없는 차이를 적지 않는다', () => {
      const same = describeOutcome('SWAP_DISPLAY', {
        request: pending,
        context: context(),
        integrity: { hashOk: true, displayOk: false, ok: false },
      })
      expect(same?.tone).toBe('caught')
      expect(same?.sentence).not.toContain('배포 대상(')
    })

    it('공격 3 뒤에 거부하면 웹쉘이 놓쳤다고 하지 않는다', async () => {
      const id = tamper.ensure()
      tamper.armSwapAfterSigning(id)
      await approvalsApi.reject(id, { planId: stored(id).plan!.id, taskIds: ['t-1'], reason: '이상함' })
      const outcome = await toneOf('SWAP_AFTER_SIGN', id)
      expect(outcome?.tone).toBe('unverified')
      expect(outcome?.sentence).toContain('웹쉘 검증까지 가지 않았습니다')
      expect(outcome?.sentence).not.toContain('방어가 작동하지')
    })

    it('공격 3 뒤에 요청자가 취소하면 웹쉘이 놓쳤다고 하지 않는다', async () => {
      const id = tamper.ensure()
      tamper.armSwapAfterSigning(id)
      setAccessToken(devControls.switchUser('u-01'))
      await requestsApi.cancel(id)
      const request = await requestsApi.get(id)
      expect(describeOutcome('SWAP_AFTER_SIGN', { request })?.tone).toBe('unverified')
    })

    it('공격 3: 서명했지만 웹쉘에 연결되지 않으면 서명을 다시 권하지 않고, 연결되면 막는다', async () => {
      mockConfig.webshellRetryMs = 1
      const id = tamper.ensure()
      tamper.armSwapAfterSigning(id)
      mockConfig.webshellReachable = false
      await sign(id)
      const offline = await toneOf('SWAP_AFTER_SIGN', id)
      expect(offline?.tone).toBe('unverified')
      expect(offline?.sentence).toContain('아직 웹쉘 검증까지 가지 않았습니다')
      expect(stored(id).armedPlanSwap).toBeDefined()

      mockConfig.webshellReachable = true
      await vi.waitFor(() => expect(stored(id).status).toBe('VERIFICATION_FAILED'))
      expect((await toneOf('SWAP_AFTER_SIGN', id))?.tone).toBe('caught')
    })

    it('공격 3: 서명 전에 기기 확인을 통과하지 못하면 웹쉘까지 못 갔다고 한다', () => {
      const failed = { hashOk: true, displayOk: true, ok: false }
      expect(describeOutcome('SWAP_AFTER_SIGN', { request: pending, integrity: failed })?.tone).toBe('unverified')
      expect(describeOutcome('SWAP_AFTER_SIGN', { request: pending })).toBeNull()
      expect(describeOutcome('SWAP_AFTER_SIGN', { request: pending, contextFailed: true })?.tone).toBe('unverified')
    })

    it('공격 4: 웹쉘에 연결되지 않으면 놓쳤다고 하지 않고, 연결되면 막는다', async () => {
      mockConfig.webshellRetryMs = 1
      const id = tamper.ensure()
      mockConfig.webshellReachable = false
      tamper.forgeApproval(id)
      expect(stored(id).status).toBe('PENDING_APPROVAL')
      const offline = describeOutcome('FORGE_APPROVAL', { request: await requestsApi.get(id) })
      expect(offline?.tone).toBe('unverified')
      expect(offline?.sentence).toContain('웹쉘 검증까지 가지 않았습니다')

      mockConfig.webshellReachable = true
      await vi.waitFor(() => expect(stored(id).status).toBe('VERIFICATION_FAILED'))
      expect(describeOutcome('FORGE_APPROVAL', { request: await requestsApi.get(id) })?.tone).toBe('caught')
    })

    it('공격 3·4: 검증을 통과해야 갈 수 있는 상태에서만 웹쉘이 놓쳤다고 한다', () => {
      for (const status of ['RUNNING', 'COMPLETED', 'FAILED', 'KILLED'] as const) {
        const request = { status, failedChecks: [], approvalRecordCount: 1 }
        expect(describeOutcome('SWAP_AFTER_SIGN', { request })?.tone).toBe('missed')
        expect(describeOutcome('FORGE_APPROVAL', { request })?.tone).toBe('missed')
      }
      for (const status of ['REJECTED', 'CANCELED', 'REAPPROVAL_REQUIRED', 'REVIEWING'] as const) {
        const request = { status, failedChecks: [], approvalRecordCount: 0 }
        expect(describeOutcome('SWAP_AFTER_SIGN', { request })?.tone).toBe('unverified')
        expect(describeOutcome('FORGE_APPROVAL', { request })?.tone).toBe('unverified')
      }
    })

    it('공격 3·4: 웹쉘이 다른 이유로 멈췄으면 막았다고도 놓쳤다고도 하지 않고 코드를 보여 준다', () => {
      const request = { status: 'VERIFICATION_FAILED' as const, failedChecks: ['KEY_NOT_REGISTERED' as const], approvalRecordCount: 1 }
      for (const attack of ['SWAP_AFTER_SIGN', 'FORGE_APPROVAL'] as const) {
        const outcome = describeOutcome(attack, { request })
        expect(outcome?.tone).toBe('unverified')
        expect(outcome?.codes).toEqual(['KEY_NOT_REGISTERED'])
      }
    })
  })

  it('처음부터는 시연 요청만 새로 만들고 지난 흔적을 지운다', async () => {
    const id = tamper.ensure()
    const others = JSON.stringify(db().requests.filter((request) => request.id !== id))
    tamper.forgeApproval(id)
    expect(db().auditLogs.some((log) => log.target.requestId === id)).toBe(true)
    expect(db().slackOutbox.some((message) => message.link === `/requests/${id}`)).toBe(true)

    const next = tamper.reset()
    expect(next).not.toBe(id)
    expect(tamper.currentId()).toBe(next)
    expect(tamper.attackOf(next)).toBeNull()
    expect(stored(next)).toMatchObject({ status: 'PENDING_APPROVAL', approvals: [], approvalRecords: [], failedChecks: [] })
    expect(db().requests.some((request) => request.id === id)).toBe(false)
    expect(db().auditLogs.some((log) => log.target.requestId === id)).toBe(false)
    expect(db().slackOutbox.some((message) => message.link === `/requests/${id}`)).toBe(false)
    expect(JSON.stringify(db().requests.filter((request) => request.id !== next))).toBe(others)
    expect((await evidence(next)).integrity.ok).toBe(true)
  })

  it('시연 화면을 떠나면 시연 요청과 흔적이 사라지고, 그 요청의 상세를 보는 동안에는 남는다', async () => {
    const pendingBefore = (await approvalsApi.pending()).items.length
    const id = tamper.ensure()
    expect((await approvalsApi.pending()).items.length).toBe(pendingBefore + 1)
    tamper.forgeApproval(id)

    expect(tamper.sweep('/demo/tamper')).toBe(false)
    expect(tamper.sweep(`/requests/${id}`)).toBe(false)
    expect(tamper.currentId()).toBe(id)

    expect(tamper.sweep('/approvals')).toBe(true)
    expect(tamper.currentId()).toBeNull()
    expect((await approvalsApi.pending()).items.length).toBe(pendingBefore)
    expect(db().auditLogs.some((log) => log.target.requestId === id)).toBe(false)
    expect(db().slackOutbox.some((message) => message.link === `/requests/${id}`)).toBe(false)
    expect(tamper.sweep('/approvals')).toBe(false)
  })

  it('공격을 겹칠 수 없다', () => {
    const id = tamper.ensure()
    tamper.armSwapAfterSigning(id)
    expect(() => tamper.forgeApproval(id)).toThrow()
  })
})
