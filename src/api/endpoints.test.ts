import { afterEach, describe, expect, it } from 'vitest'
import { setTransport } from './client'
import { approvalsApi, auditApi, dashboardApi, documentsApi, meApi, requestsApi, toProgressEvent } from './endpoints'
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

  it('dependsOn과 children이 빠져도 트리는 항상 배열을 준다', async () => {
    // 서버는 null 필드를 내려 주지 않는다 (ProgressNodeResponse). 대체된 Plan과 승인 노드의 모양이다.
    replyWith({
      requestId: 'r1',
      version: 1,
      updatedAt: 't',
      root: {
        id: 'request:r1',
        type: 'REQUEST',
        label: '요청',
        status: 'RUNNING',
        children: [
          { id: 'plan:2', type: 'PLAN', label: 'Plan v2', status: 'CURRENT', children: [{ id: 'task:1', type: 'TASK', label: '1. 작업', taskType: 'DOC', risk: 'LOW', status: 'PENDING' }] },
          { id: 'plan:1', type: 'PLAN', label: 'Plan v1', status: 'SUPERSEDED', collapsed: true },
        ],
      },
    })
    const { root } = await requestsApi.progress('r1')
    const [current, superseded] = root.children as Array<{ children: ProgressTaskNode[] }>
    expect(current.children[0]).toMatchObject({ id: 'task:1', dependsOn: [], children: [] })
    expect(superseded.children).toEqual([])
  })

  it('서버의 0부터 시작하는 작업 라벨을 1부터 보여 준다. order는 해시 대상이라 그대로 둔다', async () => {
    replyWith({
      requestId: 'r1',
      version: 1,
      updatedAt: 't',
      root: {
        id: 'request:r1',
        type: 'REQUEST',
        label: '0. 요청 프롬프트',
        status: 'REVIEWING',
        children: [{ id: 'plan:1', type: 'PLAN', label: 'Plan v1', status: 'CURRENT', children: [taskNode('task:1', []), { ...taskNode('task:2', []), label: '0. 로그인 수정' }, { ...taskNode('task:3', []), label: '1. 배포' }] }],
      },
    })
    const { root } = await requestsApi.progress('r1')
    const plan = root.children[0] as { children: ProgressTaskNode[] }
    expect(plan.children.map((task) => task.label)).toEqual(['task:1', '2. 로그인 수정', '3. 배포'])
    expect(root.label).toBe('0. 요청 프롬프트')
  })

  it('루트에 children이 없어도 깨지지 않는다', async () => {
    replyWith({ requestId: 'r1', version: 1, updatedAt: 't', root: { id: 'request:r1', type: 'REQUEST', label: '요청', status: 'ANALYZING' } })
    expect((await requestsApi.progress('r1')).root.children).toEqual([])
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

describe('감사 로그', () => {
  it('시스템 기록은 actor, network, ip, detail이 빠져도 읽힌다', async () => {
    const system = { id: 'l1', at: 't', action: 'TASK_SUCCEEDED', target: { requestId: 'r1', taskIds: null } }
    replyWith({ items: [system], nextCursor: null })
    const [log] = (await auditApi.list({})).items
    expect(log).toEqual({ ...system, actor: null, network: null, ip: null, detail: {} })
    replyWith({ id: 'l1', at: 't', action: 'LOGIN' })
    expect(await auditApi.get('l1')).toMatchObject({ actor: null, target: {}, detail: {} })
  })

  it('있는 값은 그대로 둔다', async () => {
    const full = { id: 'l1', at: 't', action: 'LOGIN', actor: { id: 'u1', name: '김담당' }, target: { requestId: null, taskIds: [] }, network: 'INTERNAL', ip: '10.0.0.1', detail: { a: 1 } }
    replyWith(full)
    expect(await auditApi.get('l1')).toEqual(full)
  })
})

describe('문서', () => {
  it('현재 버전은 문서 목록의 currentVersion을 읽는다. 버전 번호 최댓값으로 짐작하지 않는다', async () => {
    const sent: string[] = []
    setTransport(async (url) => {
      sent.push(String(url))
      const body = String(url).includes('/documents?') || String(url).endsWith('/documents')
        ? { items: [{ id: 'd1', projectId: 'p1', title: 'x', path: 'x.md', currentVersion: 2, updatedAt: 't' }], nextCursor: null }
        : { documentId: 'd1', version: 2, body: '본문', createdAt: 't' }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    expect(await documentsApi.current('p1', 'd1')).toMatchObject({ version: 2, body: '본문' })
    expect(sent.some((url) => url.includes('/projects/p1/documents'))).toBe(true)
    expect(sent.some((url) => url.includes('/documents/d1/versions/2'))).toBe(true)
    expect(sent.some((url) => /\/versions(\?|$)/.test(url))).toBe(false)
    await expect(documentsApi.current('p1', '없는 문서')).rejects.toThrow('문서를 찾을 수 없습니다')
  })

  it('서버 버전 응답을 그대로 읽는다. 없는 작성자를 지어내지 않는다', async () => {
    const version = { documentId: 'd1', version: 1, body: 'x', createdAt: 't' }
    replyWith(version)
    expect(await documentsApi.version('d1', 1)).toEqual(version)
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
    expect(await dashboardApi.get('COMPANY')).toMatchObject({ requestCount: null, statusCounts: null, riskCounts: null })
  })

  it('서버의 riskCounts를 위험도 패널이 읽는다. 일부만 와도 나머지를 0으로 채운다', async () => {
    replyWith({ scope: 'COMPANY', requestCount: 1, riskCounts: { HIGH: 2 }, statusCounts: { RUNNING: 1 } })
    expect((await dashboardApi.get('COMPANY')).riskCounts).toEqual({ LOW: 0, MEDIUM: 0, HIGH: 2, FORBIDDEN: 0 })
  })

  it('서버에 없는 부서별 비교는 빠진 채로 둔다', async () => {
    replyWith({ scope: 'COMPANY', requestCount: 1, pendingApprovalCount: 0, riskCounts: {}, statusCounts: {} })
    expect((await dashboardApi.get('COMPANY')).byDepartment).toBeUndefined()
  })

  it('재시도 응답과 롤백 응답은 서버 모양 그대로다', async () => {
    const retried = { id: 'r1', status: 'PENDING_APPROVAL', planId: 'plan-2', planHash: 'sha256:2' }
    replyWith(retried)
    expect(await requestsApi.retryFailed('r1')).toEqual(retried)
    const rolled = { requestId: 'r1', source: 'PROMPT', status: 'PENDING_APPROVAL', plan: { id: 'plan-3', kind: 'ROLLBACK' }, planHash: 'sha256:3' }
    replyWith(rolled)
    expect(await requestsApi.rollback('r1', { taskIds: ['t1'], targetVersion: 1 })).toEqual(rolled)
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
