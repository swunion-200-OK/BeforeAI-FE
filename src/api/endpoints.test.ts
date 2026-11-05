import { afterEach, describe, expect, it } from 'vitest'
import { setTransport } from './client'
import { approvalsApi, dashboardApi, meApi, requestsApi, toProgressEvent } from './endpoints'
import type { ProgressTaskNode, RequestSummary } from './types'

/** 명세가 약속한 것만 돌려주는 서버를 흉내 낸다. 명세에 없는 필드가 빠져도 읽기가 깨지면 안 된다. */
function replyWith(body: unknown) {
  setTransport(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }))
}

/** 명세 2.1의 Request 그대로 */
const SPEC_REQUEST: RequestSummary = {
  id: 'r1',
  projectId: 'p1',
  requester: { id: 'u1', name: '요청자', departmentId: 'd1' },
  prompt: '해줘',
  source: 'PROMPT',
  status: 'PENDING_APPROVAL',
  analysisAttempts: 1,
  currentPlanId: 'plan-1',
  createdAt: '2026-11-04T03:00:00Z',
  updatedAt: '2026-11-04T03:05:00Z',
}

afterEach(() => {
  setTransport(async () => {
    throw new Error('이 테스트에서 네트워크를 쓰면 안 된다')
  })
})

describe('요청 상세', () => {
  it('서버 응답을 그대로 읽는다. 없는 필드를 지어내 채우지 않는다', async () => {
    replyWith({ ...SPEC_REQUEST, currentPlan: null, approvals: [], clarification: '어느 서버에 배포할까요?' })
    const detail = await requestsApi.get('r1')
    expect(detail).toEqual({ ...SPEC_REQUEST, currentPlan: null, approvals: [], clarification: '어느 서버에 배포할까요?' })
  })
})

describe('진행 상황 트리', () => {
  const taskNode = (id: string, children: unknown[]) => ({ id, type: 'TASK', label: id, taskType: 'DOC', risk: 'LOW', status: 'PENDING', dependsOn: [], children })

  it('한 승인 기록이 여러 작업에 걸려도 트리 안의 노드 ID는 겹치지 않는다', async () => {
    const approved = { id: 'approval:a1', type: 'APPROVAL', label: '김담당', status: 'APPROVED' }
    replyWith({
      requestId: 'r1',
      version: 1,
      updatedAt: 't',
      root: {
        id: 'request:r1',
        type: 'REQUEST',
        label: '요청',
        status: 'PENDING_APPROVAL',
        children: [{ id: 'plan:1', type: 'PLAN', label: 'Plan v1', status: 'CURRENT', children: [taskNode('task:1', [approved]), taskNode('task:2', [approved])] }],
      },
    })
    const { root } = await requestsApi.progress('r1')
    const plan = root.children[0] as { children: ProgressTaskNode[] }
    expect(plan.children.map((task) => task.children[0].id)).toEqual(['task:1/approval:a1', 'task:2/approval:a1'])
  })

  it('서버 heartbeat는 id 없이 빈 객체이고, tree.replaced는 version을 담는다', () => {
    expect(toProgressEvent({ id: null, event: 'heartbeat', data: '{}' })).toEqual({ id: null, event: 'heartbeat', data: {} })
    expect(toProgressEvent({ id: '50', event: 'tree.replaced', data: '{"version":50}' })).toEqual({ id: 50, event: 'tree.replaced', data: { version: 50 } })
  })

  it('읽지 못한 패치는 버리지 않고 전체를 다시 받게 한다', () => {
    expect(toProgressEvent({ id: '43', event: 'node.updated', data: 'oops' })?.event).toBe('tree.replaced')
    expect(toProgressEvent({ id: null, event: 'node.updated', data: '{"nodeId":"a","status":"X","at":"t"}' })?.event).toBe('tree.replaced')
    expect(toProgressEvent({ id: '44', event: 'node.updated', data: '{"nodeId":"a"}' })?.event).toBe('tree.replaced')
  })

  it('서버의 node.updated를 그대로 옮긴다', () => {
    expect(toProgressEvent({ id: '43', event: 'node.updated', data: '{"nodeId":"request:c","status":"CANCELED","at":"t"}' })).toEqual({
      id: 43,
      event: 'node.updated',
      data: { nodeId: 'request:c', status: 'CANCELED', at: 't' },
    })
  })

  it('서버가 보내지 않는 이벤트는 버린다', () => {
    expect(toProgressEvent({ id: '44', event: 'node.added', data: '{}' })).toBeNull()
    expect(toProgressEvent({ id: '45', event: 'something.new', data: '{}' })).toBeNull()
  })
})

describe('명세에 모양이 없는 응답', () => {
  it('승인 대기 항목은 서버 모양 그대로다: 위험도와 제목은 task 안에 있다', async () => {
    const item = { requestId: 'r1', planId: 'plan-1', requester: SPEC_REQUEST.requester, requestedAt: 'x', task: { id: 't1', title: '작업', risk: 'HIGH' } }
    replyWith({ items: [item], nextCursor: null })
    expect((await approvalsApi.pending()).items).toEqual([item])
  })

  it('대시보드 집계가 빠지면 0이 아니라 모른다고 한다', async () => {
    replyWith({ scope: 'COMPANY' })
    expect(await dashboardApi.get('COMPANY')).toMatchObject({ requestCount: null, statusCounts: null, riskDistribution: null })
  })

  it('위험도 분포는 일부만 와도 나머지를 0으로 채운다', async () => {
    replyWith({ scope: 'COMPANY', requestCount: 1, riskDistribution: { HIGH: 2 }, statusCounts: { RUNNING: 1 } })
    expect((await dashboardApi.get('COMPANY')).riskDistribution).toEqual({ LOW: 0, MEDIUM: 0, HIGH: 2, FORBIDDEN: 0 })
  })

  it('재시도 응답은 서버 모양 그대로이고, 롤백 응답에 본인 승인 목록이 없어도 제출 흐름이 멈추지 않는다', async () => {
    const retried = { id: 'r1', status: 'PENDING_APPROVAL', planId: 'plan-2', planHash: 'sha256:2' }
    replyWith(retried)
    expect(await requestsApi.retryFailed('r1')).toEqual(retried)
    // 롤백이 새 요청을 만들면 그 id로 가야 한다.
    replyWith({ id: 'r2', status: 'PENDING_APPROVAL', planId: 'plan-3', planHash: 'sha256:3' })
    expect(await requestsApi.rollback('r1', { documentId: 'd', version: 1 })).toMatchObject({ id: 'r2', selfApprovableTaskIds: [] })
  })

  it('OTP 확인은 verified가 아니면 성공으로 치지 않는다', async () => {
    // 서버가 확인 코드를 읽지 못하면 200으로 새 비밀키를 준다.
    replyWith({ secret: 'NEW', otpauthUri: 'otpauth://x', verified: false })
    await expect(meApi.confirmOtp('123456')).rejects.toThrow('다시 등록')
    replyWith({ verified: true })
    await expect(meApi.confirmOtp('123456')).resolves.toEqual({ verified: true })
  })

  it('빈 OTP 번호는 보내지 않고, 발급 요청에는 본문을 싣지 않는다', async () => {
    const bodies: unknown[] = []
    setTransport(async (_url, init) => {
      bodies.push(init?.body)
      return new Response(JSON.stringify({ secret: 'S', verified: false }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    await expect(meApi.confirmOtp('  ')).rejects.toThrow('입력')
    expect(bodies).toEqual([])
    await meApi.issueOtpSecret()
    expect(bodies).toEqual([undefined])
  })

  it('웹쉘 공개키의 값이 없으면 기기에 고정하지 않도록 멈춘다', async () => {
    replyWith({ publicKey: 'x', fingerprint: 'fp' })
    await expect(meApi.webshellPublicKey()).rejects.toThrow('웹쉘 공개키')
  })
})
