// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deviceStore } from '../../crypto/deviceStore'
import { signAndSubmitApproval, verifyIntegrity } from '../../features/approvals/approvalFlow'
import { documentHiddenReason, downloadBlockedReason } from '../../features/approvals/approvalDocumentView'
import { rawFetch, setAccessToken, setTransport } from '../client'
import { approvalDocumentApi, approvalsApi, meApi, requestsApi } from '../endpoints'
import type { RequestStatus } from '../types'
import { devControls, initMock, mockFetch } from './index'
import { addRequest, buildSeed, deployTask } from './seed'
import { db, mockConfig, setStatus } from './store'

class MemoryStorage {
  private map = new Map<string, string>()
  getItem = (key: string) => this.map.get(key) ?? null
  setItem = (key: string, value: string) => void this.map.set(key, value)
  removeItem = (key: string) => void this.map.delete(key)
}

/** node에는 canvas가 없다. 그림은 실제 코드로 그리되 글자만 받아 적고, JPEG 대신 표시용 바이트를 돌려준다. */
const FAKE_JPEG_BASE64 = '/9j/4AAQSkZJRg=='
let drawn: string[]

function stubCanvas() {
  drawn = []
  const ctx = new Proxy(
    {
      measureText: (text: string) => ({ width: text.length * 10 }),
      fillText: (text: string) => void drawn.push(text),
    } as Record<string | symbol, unknown>,
    {
      get: (target, key) => (key in target ? target[key] : () => {}),
      set: () => true,
    },
  )
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toDataURL: () => `data:image/jpeg;base64,${FAKE_JPEG_BASE64}`,
  }
  vi.stubGlobal('document', { createElement: () => canvas })
}

function asUser(userId: string, network: 'INTERNAL' | 'EXTERNAL' = 'INTERNAL') {
  devControls.setNetwork(network)
  setAccessToken(devControls.switchUser(userId))
}

async function waitForStatus(requestId: string, predicate: (status: RequestStatus) => boolean) {
  await vi.waitFor(
    async () => {
      const detail = await requestsApi.get(requestId)
      expect(predicate(detail.status), `현재 상태 ${detail.status}`).toBe(true)
    },
    { timeout: 4000, interval: 10 },
  )
  return requestsApi.get(requestId)
}

const notAnalyzing = (status: RequestStatus) => status !== 'ANALYZING'

async function approveAs(userId: string, requestId: string, taskIds: string[]) {
  asUser(userId)
  return signAndSubmitApproval({ me: await meApi.get(), context: await approvalsApi.context(requestId), taskIds })
}

const summary = async (requestId: string) =>
  (await approvalDocumentApi.versions(requestId)).items.map(({ version, status, downloadable }) => ({ version, status, downloadable }))

async function expectError(promise: Promise<unknown>, status: number, code: string) {
  await expect(promise).rejects.toMatchObject({ status, code })
}

async function pdfText(blob: Blob) {
  return new TextDecoder('latin1').decode(await blob.arrayBuffer())
}

/** 고치지 않은 프롬프트로 만든 새 요청. 요청자는 u-01이고 작업은 승인권자가 필요한 배포 하나다. */
async function reviewedRequest(): Promise<string> {
  asUser('u-01')
  const { id } = await requestsApi.create({ projectId: 'prj-auth', prompt: '스테이징에 배포해줘' })
  const detail = await waitForStatus(id, notAnalyzing)
  expect(detail.status).toBe('REVIEWING')
  return id
}

async function submittedRequest(): Promise<{ id: string; taskId: string }> {
  const id = await reviewedRequest()
  await requestsApi.submit(id)
  const detail = await requestsApi.get(id)
  return { id, taskId: detail.currentPlan!.tasks[0].id }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
  mockConfig.latencyMs = 0
  mockConfig.analysisMs = 1
  mockConfig.execStepMs = 1
  mockConfig.webshellRetryMs = 1
  mockConfig.webshellReachable = true
  setTransport(mockFetch)
  initMock()
  deviceStore.clear()
  buildSeed()
  stubCanvas()
  asUser('u-01')
})

afterEach(() => {
  setAccessToken(null)
  vi.unstubAllGlobals()
})

describe('승인 기록 문서 목 API', () => {
  it('제출 전이면 네 경로 모두 NOT_FOUND다', async () => {
    const id = await reviewedRequest()
    await expectError(approvalDocumentApi.latest(id), 404, 'NOT_FOUND')
    await expectError(approvalDocumentApi.versions(id), 404, 'NOT_FOUND')
    await expectError(approvalDocumentApi.version(id, 1), 404, 'NOT_FOUND')
    await expectError(approvalDocumentApi.download(id), 404, 'NOT_FOUND')
  })

  it('제출하면 v1이 생기고 승인 전에도 미리 볼 수 있지만 /pdf는 INVALID_STATE다', async () => {
    const { id } = await submittedRequest()
    expect(await summary(id)).toEqual([{ version: 1, status: 'IN_PROGRESS', downloadable: false }])

    const preview = await rawFetch('GET', `/requests/${id}/approval-document`)
    expect(preview.status).toBe(200)
    expect(preview.headers.get('Content-Type')).toBe('application/pdf')
    expect(preview.headers.get('Content-Disposition')).toContain('inline')
    expect((await pdfText(await preview.blob())).startsWith('%PDF-')).toBe(true)

    await expectError(approvalDocumentApi.download(id), 409, 'INVALID_STATE')
  })

  it('미리보기 Blob은 PDF 형식이고, 없는 판은 NOT_FOUND다', async () => {
    const { id } = await submittedRequest()
    const blob = await approvalDocumentApi.version(id, 1)
    expect(blob.type).toBe('application/pdf')
    await expectError(approvalDocumentApi.version(id, 2), 404, 'NOT_FOUND')
  })

  it('승인이 끝나면 내려받을 수 있고, 파일 이름은 백엔드와 같다', async () => {
    const { id, taskId } = await submittedRequest()
    await approveAs('u-07', id, [taskId])
    asUser('u-01')
    expect(await summary(id)).toEqual([{ version: 1, status: 'APPROVED', downloadable: true }])

    const response = await rawFetch('GET', `/requests/${id}/approval-document/pdf`)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Disposition')).toBe(`attachment; filename="approval-document-${id}.pdf"`)
    expect((await pdfText(await response.blob())).startsWith('%PDF-')).toBe(true)
  })

  it('실행이 시작돼 작업 상태가 바뀌어도 승인 완료로 남는다', async () => {
    const { id, taskId } = await submittedRequest()
    await approveAs('u-07', id, [taskId])
    asUser('u-01')
    const detail = await waitForStatus(id, (status) => status === 'COMPLETED')
    expect(detail.currentPlan!.tasks[0].status).toBe('SUCCEEDED')
    expect((await summary(id))[0].status).toBe('APPROVED')
  })

  it('도장은 승인 기록대로 찍힌다', async () => {
    const { id, taskId } = await submittedRequest()
    await approvalDocumentApi.latest(id)
    expect(drawn).toContain('승인 기록 문서')
    expect(drawn).toContain('대기')
    expect(drawn).not.toContain('김담당')

    await approveAs('u-07', id, [taskId])
    const approver = await meApi.get()
    asUser('u-01')
    drawn.length = 0
    await approvalDocumentApi.latest(id)
    expect(drawn).toContain(approver.name)
    expect(drawn).not.toContain('대기')
  })

  it('문서에 요청자, 프로젝트, 프롬프트, Plan 해시가 들어간다', async () => {
    const { id } = await submittedRequest()
    const detail = await requestsApi.get(id)
    await approvalDocumentApi.latest(id)
    const page = drawn.join('\n')
    expect(page).toContain(detail.requester.name)
    expect(page).toContain(detail.prompt)
    expect(page).toContain('프로젝트')
    // 긴 해시는 줄이 나뉠 수 있어 이어 붙여 본다.
    expect(drawn.join('')).toContain(detail.currentPlan!.planHash)
  })

  it('고친 Plan을 다시 제출하면 판이 늘고 이전 판은 SUPERSEDED로 도장과 함께 남는다', async () => {
    const before = await requestsApi.get('r-main')
    expect((await summary('r-main'))[0]).toMatchObject({ version: 1, status: 'IN_PROGRESS' })
    await requestsApi.patchPlan('r-main', {
      basePlanId: before.currentPlanId!,
      changes: [{ op: 'UPDATE', taskId: 't-1', instruction: '메시지를 한국어와 영어 둘 다 보여줘' }],
    })
    const patched = await waitForStatus('r-main', notAnalyzing)
    expect(patched.status).toBe('REAPPROVAL_REQUIRED')
    expect(await summary('r-main')).toEqual([{ version: 1, status: 'REVISING', downloadable: false }])
    await expectError(approvalDocumentApi.download('r-main'), 409, 'INVALID_STATE')

    await requestsApi.submit('r-main')
    expect(await summary('r-main')).toEqual([
      { version: 2, status: 'IN_PROGRESS', downloadable: false },
      { version: 1, status: 'SUPERSEDED', downloadable: false },
    ])

    const signer = before.requester.name
    drawn.length = 0
    await approvalDocumentApi.version('r-main', 1)
    expect(drawn).toContain(signer)
    expect(drawn.some((text) => text.includes('제 1판') && text.includes('최신은 제 2판'))).toBe(true)
    drawn.length = 0
    await approvalDocumentApi.latest('r-main')
    expect(drawn).not.toContain(signer)
  })

  it('같은 Plan을 다시 제출하면 판이 늘지 않는다', async () => {
    expect(await summary('r-verify-failed')).toHaveLength(1)
    await requestsApi.submit('r-verify-failed')
    expect(await summary('r-verify-failed')).toHaveLength(1)
  })

  it('실패 작업 재시도 Plan은 판을 만들지 않는다', async () => {
    const before = await summary('r-partial')
    await requestsApi.retryFailed('r-partial')
    expect((await summary('r-partial')).map((item) => item.version)).toEqual(before.map((item) => item.version))
  })

  it('승인 중에 거부되면 내려받을 수 없다', async () => {
    asUser('u-07')
    await approvalsApi.reject('r-main', { planId: (await requestsApi.get('r-main')).currentPlanId!, taskIds: ['t-2'], reason: '사유' })
    expect(await summary('r-main')).toEqual([{ version: 1, status: 'REJECTED', downloadable: false }])
    await expectError(approvalDocumentApi.download('r-main'), 409, 'INVALID_STATE')
  })

  it('전부 승인한 뒤 거부되면 내려받을 수 없다', async () => {
    // 웹쉘이 닿지 않으면 승인이 다 모여도 실행되지 않고 승인대기에 남는다.
    mockConfig.webshellReachable = false
    const { id, taskId } = await submittedRequest()
    await approveAs('u-07', id, [taskId])
    asUser('u-01')
    expect(await summary(id)).toEqual([{ version: 1, status: 'APPROVED', downloadable: true }])

    // 모두 승인한 뒤에는 거부 API의 승인권자 확인을 통과할 사람이 없어 상태를 직접 바꾼다.
    setStatus(db().requests.find((request) => request.id === id)!, 'REJECTED', '김담당')
    expect(await summary(id)).toEqual([{ version: 1, status: 'REJECTED', downloadable: false }])
    await expectError(approvalDocumentApi.download(id), 409, 'INVALID_STATE')
  })

  it('취소되거나 중단되면 그 상태가 되고 내려받을 수 없다', async () => {
    await requestsApi.cancel('r-main')
    expect((await summary('r-main'))[0]).toMatchObject({ status: 'CANCELED', downloadable: false })
    await expectError(approvalDocumentApi.download('r-main'), 409, 'INVALID_STATE')

    expect((await summary('r-killed'))[0]).toMatchObject({ status: 'KILLED', downloadable: false })
  })

  it('에디터 변경과 문서 롤백은 대상이 아니다', async () => {
    addRequest({ id: 'r-editor', requesterId: 'u-01', prompt: '에디터 변경', status: 'PENDING_APPROVAL', ageMinutes: 5, source: 'EDITOR', tasks: [deployTask('PENDING')] })
    await expectError(approvalDocumentApi.versions('r-editor'), 404, 'NOT_FOUND')
    await expectError(approvalDocumentApi.versions('r-rolled-back'), 404, 'NOT_FOUND')
  })

  it('외부망에서도 볼 수 있다', async () => {
    asUser('u-01', 'EXTERNAL')
    expect(await summary('r-completed')).toHaveLength(2)
    await expect(approvalDocumentApi.latest('r-completed')).resolves.toBeInstanceOf(Blob)
  })

  it('시드에서 판 목록과 승인 완료 문서를 바로 볼 수 있다', async () => {
    expect(await summary('r-completed')).toEqual([
      { version: 2, status: 'APPROVED', downloadable: true },
      { version: 1, status: 'SUPERSEDED', downloadable: false },
    ])
  })

  it('이전 판의 저장은 상한이 있고 판 번호는 이어진다', async () => {
    for (let round = 0; round < 7; round += 1) {
      const { currentPlanId } = await requestsApi.get('r-main')
      await requestsApi.patchPlan('r-main', {
        basePlanId: currentPlanId!,
        changes: [{ op: 'UPDATE', taskId: 't-1', instruction: `문구 수정 ${round}` }],
      })
      await waitForStatus('r-main', notAnalyzing)
      await requestsApi.submit('r-main')
    }
    const versions = (await summary('r-main')).map((item) => item.version)
    expect(versions).toEqual([8, 7, 6, 5, 4, 3])
    expect(db().requests.find((request) => request.id === 'r-main')!.documentVersions!.filter((item) => item.retired)).toHaveLength(5)
    await expectError(approvalDocumentApi.version('r-main', 1), 404, 'NOT_FOUND')
    await expect(approvalDocumentApi.version('r-main', 3)).resolves.toBeInstanceOf(Blob)
  })

  it('내용이 쪽을 넘으면 잘라 내지 않고 줄여서 다시 그린다', async () => {
    const tasks = Array.from({ length: 12 }, () => deployTask('PENDING'))
    addRequest({ id: 'r-long', requesterId: 'u-01', prompt: '긴 요청', status: 'PENDING_APPROVAL', ageMinutes: 5, tasks })
    await approvalDocumentApi.latest('r-long')
    // 줄이기 전 한 번, 줄인 뒤 한 번 그린다.
    expect(drawn.filter((text) => text === '승인 기록 문서')).toHaveLength(2)
  })
})

describe('변조 시연의 공격과 승인 기록 문서', () => {
  const { tamper } = devControls

  async function integrityOf(requestId: string) {
    asUser('u-07')
    const request = await requestsApi.get(requestId)
    return verifyIntegrity(await approvalsApi.context(requestId), 'u-07', request.projectId)
  }

  const expectHidden = (failed: boolean) => expect(documentHiddenReason(failed)).toBe('무결성 확인에 실패해 문서를 표시하지 않습니다')

  it('공격하지 않으면 무결성 확인을 통과해 문서를 보여 준다', async () => {
    const integrity = await integrityOf(tamper.ensure())
    expect(documentHiddenReason(!integrity.ok)).toBeNull()
  })

  it('공격 1: 내용만 바꾸면 무결성 확인에 실패해 문서를 표시하지 않는다', async () => {
    const id = tamper.ensure()
    tamper.swapBeforeSigning(id)
    const integrity = await integrityOf(id)
    expect(integrity).toMatchObject({ hashOk: false, displayOk: true, ok: false })
    expectHidden(!integrity.ok)
  })

  it('공격 2: 화면의 Plan만 다르면 무결성 확인에 실패해 문서를 표시하지 않는다', async () => {
    const id = tamper.ensure()
    tamper.swapDisplayOnly(id)
    const integrity = await integrityOf(id)
    expect(integrity).toMatchObject({ hashOk: true, displayOk: false, ok: false })
    expectHidden(!integrity.ok)
  })

  it('공격 3: 서명 뒤 바꿔치기로 검증에 실패하면 승인 완료가 아니고 내려받을 수 없다', async () => {
    const id = tamper.ensure()
    tamper.armSwapAfterSigning(id)
    const result = await approveAs('u-07', id, ['t-1'])
    expect(result.status).toBe('VERIFICATION_FAILED')

    const [latest] = (await approvalDocumentApi.versions(id)).items
    expect(latest).toMatchObject({ version: 1, status: 'IN_PROGRESS', downloadable: false })
    await expectError(approvalDocumentApi.download(id), 409, 'INVALID_STATE')

    expect(downloadBlockedReason(latest, 'VERIFICATION_FAILED')).toBe('웹쉘 검증에 실패해 내려받을 수 없습니다')
    await approvalDocumentApi.version(id, 1)
    // 서명 자체는 실제로 제출됐으므로 도장은 남고, 검증 실패를 함께 적는다.
    expect(drawn).toContain('김담당')
    expect(drawn.some((text) => text.includes('웹쉘 검증 실패'))).toBe(true)
  })

  it('공격 4: 지어낸 승인은 승인 완료가 아니고 도장도 찍히지 않으며 내려받을 수 없다', async () => {
    const id = tamper.ensure()
    tamper.forgeApproval(id)
    asUser('u-07')
    expect((await requestsApi.get(id)).status).toBe('VERIFICATION_FAILED')

    const [latest] = (await approvalDocumentApi.versions(id)).items
    expect(latest).toMatchObject({ version: 1, status: 'IN_PROGRESS', downloadable: false })
    await expectError(approvalDocumentApi.download(id), 409, 'INVALID_STATE')

    await approvalDocumentApi.version(id, 1)
    expect(drawn).not.toContain('김담당')
    expect(drawn).toContain('대기')
    expect(drawn.some((text) => text.includes('웹쉘 검증 실패'))).toBe(true)
  })

  it('공격 4에서 웹쉘이 닿지 않아 승인대기에 남아도 서명 없는 승인으로 승인 완료가 되지 않는다', async () => {
    mockConfig.webshellReachable = false
    const id = tamper.ensure()
    tamper.forgeApproval(id)
    asUser('u-07')
    expect((await requestsApi.get(id)).status).toBe('PENDING_APPROVAL')
    expect((await approvalDocumentApi.versions(id)).items[0]).toMatchObject({ status: 'IN_PROGRESS', downloadable: false })
    await expectError(approvalDocumentApi.download(id), 409, 'INVALID_STATE')
  })
})
