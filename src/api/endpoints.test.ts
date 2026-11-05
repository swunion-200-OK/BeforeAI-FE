import { afterEach, describe, expect, it } from 'vitest'
import { setTransport } from './client'
import { adminApi, approvalsApi, dashboardApi, editorApi, meApi, orgApi, projectsApi, requestsApi, toProgressEvent } from './endpoints'
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
  it('명세의 Request만 와도 화면이 읽는 목록을 채운다', async () => {
    replyWith(SPEC_REQUEST)
    const detail = await requestsApi.get('r1')
    expect(detail).toMatchObject({
      plan: null,
      approvalStatus: [],
      changedTaskIds: [],
      removedTaskTitles: [],
      failedChecks: [],
      events: [],
      rejection: null,
      kill: null,
      clarification: null,
    })
    // 없다고 통과로 보면 안 된다. 관문은 이 값이 없으면 서명 검사를 통과라고 말하지 않는다.
    expect(detail.approvalRecordCount).toBeUndefined()
  })

  it('null로 와도 기본값이 덮이지 않는다', async () => {
    replyWith({ ...SPEC_REQUEST, approvalStatus: null, events: null, failedChecks: null, changedTaskIds: null })
    const detail = await requestsApi.get('r1')
    expect(detail.approvalStatus).toEqual([])
    expect(detail.events).toEqual([])
    expect(detail.failedChecks).toEqual([])
    expect(detail.changedTaskIds).toEqual([])
  })

  it('명세 4.1의 clarification이 문자열이어도 질문으로 읽는다', async () => {
    replyWith({ ...SPEC_REQUEST, clarification: '어느 서버에 배포할까요?' })
    expect((await requestsApi.get('r1')).clarification).toEqual({ question: '어느 서버에 배포할까요?' })
  })

  it('승인 현황의 충족 여부를 모르면 충족으로 보지 않는다', async () => {
    replyWith({ ...SPEC_REQUEST, approvalStatus: [{ taskId: 't1', requirements: [{ rule: 'PROJECT_OWNER', count: 1, candidates: ['u7'] }] }] })
    const [status] = (await requestsApi.get('r1')).approvalStatus
    expect(status.requirements[0]).toMatchObject({ satisfied: false, approvedBy: [], candidates: [] })
  })
})

describe('진행 상황 트리', () => {
  it('자식이나 선행 작업이 빠져도 배열로 맞춘다', async () => {
    replyWith({
      version: 1,
      updatedAt: '2026-11-04T03:15:20Z',
      root: {
        id: 'request:1',
        type: 'REQUEST',
        label: '요청',
        status: 'RUNNING',
        children: [{ id: 'plan:1', type: 'PLAN', label: 'Plan', status: 'CURRENT', children: [{ id: 'task:1', type: 'TASK', label: '1. 작업', taskType: 'DOC', status: 'PENDING' }] }, { id: 'plan:0', type: 'PLAN', label: 'Plan v1', status: 'SUPERSEDED', collapsed: true }],
      },
    })
    const { root } = await requestsApi.progress('r1')
    const [plan, old] = root.children as Array<{ children: ProgressTaskNode[] }>
    expect(plan.children[0].children).toEqual([])
    expect(plan.children[0].dependsOn).toEqual([])
    expect(old.children).toEqual([])
  })

  it('heartbeat와 tree.replaced는 본문이 비어 있거나 JSON이 아니어도 읽는다', () => {
    expect(toProgressEvent({ id: null, event: 'heartbeat', data: '' })).toEqual({ id: null, event: 'heartbeat', data: { at: '' } })
    expect(toProgressEvent({ id: null, event: 'heartbeat', data: 'ping' })?.event).toBe('heartbeat')
    expect(toProgressEvent({ id: '50', event: 'tree.replaced', data: '' })).toEqual({ id: 50, event: 'tree.replaced', data: { at: '' } })
  })

  it('읽지 못한 패치는 버리지 않고 전체를 다시 받게 한다', () => {
    expect(toProgressEvent({ id: '43', event: 'node.updated', data: 'oops' })?.event).toBe('tree.replaced')
    expect(toProgressEvent({ id: null, event: 'node.updated', data: '{"nodeId":"a","at":"t"}' })?.event).toBe('tree.replaced')
    expect(toProgressEvent({ id: '44', event: 'node.added', data: '{"parentId":"a"}' })?.event).toBe('tree.replaced')
  })

  it('명세 4.9의 예시를 그대로 옮긴다', () => {
    expect(toProgressEvent({ id: '43', event: 'node.updated', data: '{"nodeId":"task:c","status":"SUCCEEDED","at":"t"}' })).toEqual({
      id: 43,
      event: 'node.updated',
      data: { nodeId: 'task:c', status: 'SUCCEEDED', at: 't' },
    })
    expect(toProgressEvent({ id: '44', event: 'node.added', data: '{"parentId":"task:c","node":{"id":"step:a","type":"STEP","label":"헬스 체크","status":"RUNNING"}}' })).toEqual({
      id: 44,
      event: 'node.added',
      data: { parentId: 'task:c', node: { id: 'step:a', type: 'STEP', label: '헬스 체크', status: 'RUNNING' } },
    })
  })

  it('모르는 이벤트는 버린다', () => {
    expect(toProgressEvent({ id: '45', event: 'something.new', data: '{}' })).toBeNull()
  })
})

describe('명세에 모양이 없는 응답', () => {
  it('프로젝트 목록에 담당자가 없어도 앱 뼈대가 읽을 수 있다', async () => {
    replyWith({ items: [{ id: 'p1', name: '프로젝트', departmentId: 'd1', repository: 'r' }], nextCursor: null })
    expect((await projectsApi.list()).items[0].owners).toEqual([])
  })

  it('승인 대기 항목은 명세의 값만 와도 읽는다', async () => {
    replyWith({ items: [{ requestId: 'r1', taskId: 't1', projectId: 'p1', type: 'DOC', risk: 'LOW', requestedAt: 'x' }], nextCursor: null })
    const [item] = (await approvalsApi.pending()).items
    expect(item.requester.name).toBe('알 수 없음')
    expect(item.projectName).toBe('p1')
    expect(item.blockedReason).toBeNull()
  })

  it('대시보드 집계가 빠지면 0이 아니라 모른다고 한다', async () => {
    replyWith({ scope: 'COMPANY' })
    expect(await dashboardApi.get('COMPANY')).toMatchObject({ requestCount: null, statusCounts: null, riskDistribution: null })
  })

  it('위험도 분포는 일부만 와도 나머지를 0으로 채운다', async () => {
    replyWith({ scope: 'COMPANY', requestCount: 1, riskDistribution: { HIGH: 2 }, statusCounts: { RUNNING: 1 } })
    expect((await dashboardApi.get('COMPANY')).riskDistribution).toEqual({ LOW: 0, MEDIUM: 0, HIGH: 2, FORBIDDEN: 0 })
  })

  it('승인 기준표는 표, rows, items 어느 모양이든 읽는다', async () => {
    const rows = [{ taskType: 'DOC' }]
    for (const body of [rows, { rows }, { items: rows, nextCursor: null }]) {
      replyWith(body)
      expect(await orgApi.approvalMatrix()).toEqual(rows)
    }
    replyWith({ rows })
    expect(await adminApi.updateMatrix([])).toEqual(rows)
  })

  it('디렉터리 목록은 목록 규칙의 items로 와도 읽는다', async () => {
    const entries = [{ name: 'a.ts', path: 'a.ts', type: 'file' }]
    replyWith({ items: entries, nextCursor: null, baseCommit: 'abc' })
    expect((await editorApi.files('p1')).entries).toEqual(entries)
  })

  it('재시도·롤백 응답에 본인 승인 목록이 없어도 제출 흐름이 멈추지 않는다', async () => {
    replyWith({ status: 'PENDING_APPROVAL', planId: 'plan-2', planHash: 'sha256:2' })
    expect(await requestsApi.retryFailed('r1')).toMatchObject({ id: 'r1', selfApprovableTaskIds: [] })
    // 롤백이 새 요청을 만들면 그 id로 가야 한다.
    replyWith({ id: 'r2', status: 'PENDING_APPROVAL', planId: 'plan-3', planHash: 'sha256:3' })
    expect(await requestsApi.rollback('r1', { documentId: 'd', version: 1 })).toMatchObject({ id: 'r2', selfApprovableTaskIds: [] })
  })

  it('웹쉘 공개키의 값이 없으면 기기에 고정하지 않도록 멈춘다', async () => {
    replyWith({ publicKey: 'x', fingerprint: 'fp' })
    await expect(meApi.webshellPublicKey()).rejects.toThrow('웹쉘 공개키')
  })
})
