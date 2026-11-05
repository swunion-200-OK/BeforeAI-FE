// @vitest-environment node
import 'fake-indexeddb/auto'
import { unzipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUDIT_ACTION_LABEL } from '../../lib/labels'
import { rawFetch, setAccessToken, setTransport } from '../client'
import { auditApi, auditExportApi } from '../endpoints'
import type { AuditAction, AuditExportFilters, AuditLog, ExportFormat } from '../types'
import { resumeTimers } from './engine'
import { devControls, initMock, mockFetch } from './index'
import { buildSeed } from './seed'
import { db, loadPersisted, mockConfig, setDb } from './store'

const COLUMNS = ['시각(KST)', '행위자', '부서', '동작', '프로젝트', '요청 ID', '작업 ID', '접속 환경', 'IP', '결과', '상세']
const COLUMN = Object.fromEntries(COLUMNS.map((name, index) => [name, index]))

class MemoryStorage {
  private map = new Map<string, string>()
  getItem = (key: string) => this.map.get(key) ?? null
  setItem = (key: string, value: string) => void this.map.set(key, value)
  removeItem = (key: string) => void this.map.delete(key)
}

function asUser(userId: string, network: 'INTERNAL' | 'EXTERNAL' = 'INTERNAL') {
  devControls.setNetwork(network)
  setAccessToken(devControls.switchUser(userId))
}

async function waitReady(exportId: string) {
  await vi.waitFor(
    async () => {
      expect((await auditExportApi.get(exportId)).status).toBe('READY')
    },
    { timeout: 2000, interval: 5 },
  )
}

const fileResponse = (exportId: string) => rawFetch('GET', `/audit-logs/exports/${exportId}/file`)

async function readyExport(format: ExportFormat, filters: AuditExportFilters = {}) {
  const accepted = await auditExportApi.create({ format, filters })
  await waitReady(accepted.exportId)
  return accepted
}

// ── 파일 읽기 ──────────────────────────────────────────────

const decoder = new TextDecoder()

function parseCsv(bytes: Uint8Array): string[][] {
  const text = decoder.decode(bytes)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"') quoted = true
    else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\r') {
      continue
    } else if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += char
  }
  return rows
}

function unescapeXml(value: string) {
  return value.replaceAll('&#13;', '\r').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
}

function readXlsx(bytes: Uint8Array) {
  const files = unzipSync(bytes)
  const text = (path: string) => decoder.decode(files[path])
  const sheet = text('xl/worksheets/sheet1.xml')
  const rows = [...sheet.matchAll(/<row r="\d+">(.*?)<\/row>/gs)].map((row) =>
    [...row[1].matchAll(/<t xml:space="preserve">(.*?)<\/t>/gs)].map((cell) => unescapeXml(cell[1])),
  )
  return { files, text, sheet, rows }
}

async function rowsOf(exportId: string, format: ExportFormat): Promise<string[][]> {
  const bytes = new Uint8Array(await (await fileResponse(exportId)).arrayBuffer())
  return format === 'CSV' ? parseCsv(bytes) : readXlsx(bytes).rows
}

async function readyRows(format: ExportFormat, filters: AuditExportFilters = {}) {
  const { exportId, rowCount } = await readyExport(format, filters)
  const [header, ...rows] = await rowsOf(exportId, format)
  return { exportId, rowCount, header, rows }
}

// ── 준비 ───────────────────────────────────────────────────

function addLog(overrides: Partial<AuditLog> & { action: AuditAction }) {
  const log: AuditLog = {
    id: `log-test-${db().auditLogs.length}`,
    at: new Date(Date.now() - 60_000).toISOString(),
    actor: { id: 'u-admin', name: '박CTO' },
    target: {},
    network: 'INTERNAL',
    ip: '100.64.12.34',
    detail: {},
    ...overrides,
  }
  db().auditLogs.unshift(log)
  return log
}

/** 목록 API를 끝까지 넘겨 내보내기와 같은 조건의 정답을 만든다. */
async function listAll(filters: AuditExportFilters = {}) {
  const items: AuditLog[] = []
  let cursor: string | undefined
  do {
    const page = await auditApi.list({ ...filters, cursor, limit: 100 })
    items.push(...page.items)
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return items
}

beforeEach(async () => {
  vi.stubGlobal('localStorage', new MemoryStorage())
  mockConfig.latencyMs = 0
  mockConfig.auditExportMs = 1
  mockConfig.auditExportLimit = 100000
  setTransport(mockFetch)
  await initMock()
  await buildSeed()
  asUser('u-admin')
})

afterEach(() => {
  setAccessToken(null)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('역할별 범위 (3.2)', () => {
  it('관리자는 전체 기록을 내보낸다', async () => {
    const seeded = db().auditLogs.length
    const { rowCount, rows } = await readyRows('CSV')
    expect(rowCount).toBe(seeded)
    expect(rows).toHaveLength(seeded)
  })

  it('부서 관리자는 소속 부서 기록만 내보낸다', async () => {
    asUser('u-mgr-in')
    const expected = await listAll()
    const { rowCount, rows } = await readyRows('XLSX')
    expect(rowCount).toBe(expected.length)
    expect(rows.map((row) => row[COLUMN['요청 ID']])).toEqual(expected.map((log) => log.target.requestId ?? ''))
    expect(rowCount).toBeGreaterThan(0)
    expect(rowCount).toBeLessThan(db().auditLogs.length)
    // 백엔드 프로젝트의 요청은 인프라 팀장 파일에 없다
    expect(rows.some((row) => row[COLUMN['요청 ID']] === 'r-rejected')).toBe(false)
  })

  it('직원은 본인 요청 기록만 내보낸다', async () => {
    asUser('u-01')
    const { rows } = await readyRows('CSV')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      const request = db().requests.find((r) => r.id === row[COLUMN['요청 ID']])
      expect(request?.requester.id).toBe('u-01')
    }
  })

  it('직원: 본인이 행위자여도 본인 요청이 아니면 빠지고, 남이 한 일도 본인 요청이면 들어간다', async () => {
    const othersRequest = db().requests.find((r) => r.requester.id !== 'u-01')?.id as string
    const me = { id: 'u-01', name: '홍길동' }
    addLog({ action: 'APPROVAL_SUBMITTED', actor: me, target: { requestId: othersRequest, label: '남의 요청에 내가 함' } })
    addLog({ action: 'LOGIN', actor: me, target: { label: '요청 없는 내 기록' } })
    addLog({ action: 'REJECTED', actor: { id: 'u-07', name: '김담당' }, target: { requestId: 'r-main', label: '내 요청에 남이 함' } })
    asUser('u-01')
    for (const format of ['CSV', 'XLSX'] as const) {
      const details = (await readyRows(format)).rows.map((row) => row[COLUMN['상세']])
      expect(details).not.toContain('남의 요청에 내가 함')
      expect(details).not.toContain('요청 없는 내 기록')
      expect(details).toContain('내 요청에 남이 함')
    }
  })

  it('부서 관리자: 소속 직원이 행위자여도 다른 부서 요청이면 빠진다', async () => {
    addLog({ action: 'APPROVAL_SUBMITTED', actor: { id: 'u-21', name: '오인프라' }, target: { requestId: 'r-rejected', label: '다른 부서 요청' } })
    addLog({ action: 'LOGIN', actor: { id: 'u-21', name: '오인프라' }, target: { label: '요청 없는 소속 직원 기록' } })
    addLog({ action: 'LOGIN', actor: { id: 'u-01', name: '홍길동' }, target: { label: '요청 없는 다른 부서 기록' } })
    asUser('u-mgr-in')
    const details = (await readyRows('CSV')).rows.map((row) => row[COLUMN['상세']])
    expect(details).not.toContain('다른 부서 요청')
    expect(details).not.toContain('요청 없는 다른 부서 기록')
    expect(details).toContain('요청 없는 소속 직원 기록')
  })

  it('범위를 넘는 조건은 범위 안으로 좁힌다', async () => {
    asUser('u-01')
    const othersRequest = db().requests.find((r) => r.requester.id !== 'u-01')?.id as string
    expect((await readyRows('CSV', { requestId: othersRequest })).rowCount).toBe(0)
    asUser('u-mgr-in')
    expect((await readyRows('CSV', { requestId: 'r-rejected' })).rowCount).toBe(0)
  })
})

describe('조건', () => {
  it('목록과 같은 조건을 그대로 적용한다', async () => {
    const cases: AuditExportFilters[] = [
      { network: 'EXTERNAL' },
      { action: 'APPROVAL_SUBMITTED' },
      { actorId: 'u-07' },
      { departmentId: 'd-infra' },
      { projectId: 'prj-auth' },
      { requestId: 'r-main' },
      { from: new Date(Date.now() - 3 * 60 * 60_000).toISOString(), to: new Date(Date.now() - 60 * 60_000).toISOString() },
      { network: 'EXTERNAL', action: 'APPROVAL_SUBMITTED', actorId: 'u-07' },
    ]
    for (const filters of cases) {
      const expected = await listAll(filters)
      expect(expected.length, JSON.stringify(filters)).toBeGreaterThan(0)
      expect(expected.length, JSON.stringify(filters)).toBeLessThan(db().auditLogs.length)
      const { rows, rowCount } = await readyRows('CSV', filters)
      expect(rowCount, JSON.stringify(filters)).toBe(expected.length)
      expect(rows.map((row) => row[COLUMN['요청 ID']])).toEqual(expected.map((log) => log.target.requestId ?? ''))
    }
  })

  it('목록 전용 값과 모르는 조건은 저장하지 않는다', async () => {
    const { exportId } = await auditExportApi.create({
      format: 'CSV',
      filters: { network: 'EXTERNAL', cursor: '5', limit: 1, bogus: 'x' } as AuditExportFilters,
    })
    expect(db().auditExports.find((item) => item.id === exportId)?.filters).toEqual({ network: 'EXTERNAL' })
  })

  it('형식과 기간 값이 잘못되면 400이다', async () => {
    await expect(auditExportApi.create({ format: 'PDF' as ExportFormat, filters: {} })).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
    })
    await expect(auditExportApi.create({ format: 'CSV', filters: { from: 'not-a-date' } })).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
    })
  })
})

describe('제한', () => {
  it('외부망에서는 네 라우트 모두 403이다', async () => {
    const { exportId } = await readyExport('CSV')
    asUser('u-admin', 'EXTERNAL')
    const calls: Array<() => Promise<unknown>> = [
      () => auditExportApi.create({ format: 'CSV', filters: {} }),
      () => auditExportApi.list(),
      () => auditExportApi.get(exportId),
      async () => {
        const response = await fileResponse(exportId)
        if (!response.ok) throw await response.json().then((body) => ({ status: response.status, ...body.error }))
      },
    ]
    for (const call of calls) {
      await expect(call()).rejects.toMatchObject({ status: 403, code: 'INTERNAL_NETWORK_ONLY' })
    }
  })

  it('한도를 넘으면 422이고 아무것도 남지 않는다', async () => {
    const before = db().auditLogs.length
    mockConfig.auditExportLimit = 3
    await expect(auditExportApi.create({ format: 'XLSX', filters: {} })).rejects.toMatchObject({
      status: 422,
      code: 'EXPORT_TOO_LARGE',
      message: expect.stringContaining('100,000'),
    })
    expect(db().auditExports).toHaveLength(0)
    expect(db().auditLogs).toHaveLength(before)
  })

  it('한도와 같은 건수는 통과한다', async () => {
    mockConfig.auditExportLimit = db().auditLogs.length
    await expect(auditExportApi.create({ format: 'CSV', filters: {} })).resolves.toMatchObject({ status: 'PROCESSING' })
  })

  it('다른 사람은 상태도 파일도 볼 수 없고 목록에도 나오지 않는다', async () => {
    const { exportId } = await readyExport('CSV')
    for (const other of ['u-mgr-be', 'u-01']) {
      asUser(other)
      await expect(auditExportApi.get(exportId)).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' })
      expect((await fileResponse(exportId)).status).toBe(404)
      expect((await auditExportApi.list()).items).toHaveLength(0)
    }
    asUser('u-admin')
    expect((await auditExportApi.list()).items.map((item) => item.exportId)).toEqual([exportId])
  })

  it('요청자가 관리자라도 남의 내보내기는 받을 수 없다', async () => {
    asUser('u-01')
    const { exportId } = await readyExport('CSV')
    asUser('u-admin')
    expect((await fileResponse(exportId)).status).toBe(404)
  })

  it('준비 전에는 파일을 받을 수 없다', async () => {
    mockConfig.auditExportMs = 60_000
    const { exportId } = await auditExportApi.create({ format: 'CSV', filters: {} })
    const response = await fileResponse(exportId)
    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe('INVALID_STATE')
  })
})

describe('상태와 만료', () => {
  it('PROCESSING으로 시작해 타이머로 READY가 되고 Slack을 보낸다', async () => {
    mockConfig.auditExportMs = 20
    const before = db().slackOutbox.length
    const accepted = await auditExportApi.create({ format: 'XLSX', filters: {} })
    expect(accepted).toMatchObject({ status: 'PROCESSING', format: 'XLSX' })
    const processing = await auditExportApi.get(accepted.exportId)
    expect(processing).toMatchObject({ status: 'PROCESSING', expiresAt: null, downloadUrl: null })
    expect(db().slackOutbox).toHaveLength(before)

    await waitReady(accepted.exportId)
    const ready = await auditExportApi.get(accepted.exportId)
    expect(ready.downloadUrl).toBe(`/api/v1/audit-logs/exports/${accepted.exportId}/file`)
    expect(ready.fileName).toMatch(/^audit-logs_\d{8}-\d{8}\.xlsx$/)
    const hour = Date.parse(ready.expiresAt as string) - Date.now()
    expect(hour).toBeGreaterThan(59 * 60_000)
    expect(hour).toBeLessThanOrEqual(60 * 60_000)

    expect(db().slackOutbox).toHaveLength(before + 1)
    expect(db().slackOutbox[0]).toMatchObject({ toUserId: 'u-admin', link: '/audit' })
    expect(db().slackOutbox[0].text).toContain('내보내기')
  })

  it('1시간이 지나면 EXPIRED가 되고 파일이 사라진다', async () => {
    const { exportId } = await readyExport('CSV')
    expect((await fileResponse(exportId)).status).toBe(200)
    const { expiresAt } = await auditExportApi.get(exportId)

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.parse(expiresAt as string) - 1000)
    expect((await auditExportApi.get(exportId)).status).toBe('READY')

    vi.setSystemTime(Date.parse(expiresAt as string))
    const expired = await auditExportApi.get(exportId)
    expect(expired).toMatchObject({ status: 'EXPIRED', downloadUrl: null })
    expect((await auditExportApi.list()).items[0].status).toBe('EXPIRED')
    const response = await fileResponse(exportId)
    expect(response.status).toBe(409)
    expect((await response.json()).error).toMatchObject({ code: 'INVALID_STATE', details: { status: 'EXPIRED' } })
  })

  it('새로고침해도 타이머가 복구되어 READY가 되고 알림은 한 번만 간다', async () => {
    mockConfig.auditExportMs = 30
    const { exportId } = await auditExportApi.create({ format: 'CSV', filters: {} })
    const before = db().slackOutbox.length

    setDb(loadPersisted() as NonNullable<ReturnType<typeof loadPersisted>>)
    expect(db().auditExports[0].status).toBe('PROCESSING')
    resumeTimers()

    await waitReady(exportId)
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(db().slackOutbox).toHaveLength(before + 1)
  })

  it('이 칸이 없는 저장 데이터를 불러와도 동작한다', async () => {
    const legacy = db() as unknown as { auditExports?: unknown }
    delete legacy.auditExports
    resumeTimers()
    expect((await auditExportApi.list()).items).toEqual([])
  })

  it('초기화하면 이전 타이머는 알림을 보내지 않는다', async () => {
    mockConfig.auditExportMs = 10
    await auditExportApi.create({ format: 'CSV', filters: {} })
    await buildSeed()
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(db().auditExports).toHaveLength(0)
    expect(db().slackOutbox).toHaveLength(0)
  })
})

describe('파일', () => {
  it('열 11개를 명세 순서로 쓰고 시각은 KST다', async () => {
    addLog({
      action: 'TASK_FAILED',
      at: '2026-03-01T15:30:45.000Z',
      actor: { id: 'u-07', name: '김담당' },
      target: { requestId: 'r-main', taskIds: ['t-1', 't-2'], label: '라벨' },
      network: 'EXTERNAL',
      ip: '203.0.113.10',
      detail: { reason: '이유', self: true, version: 3, failedChecks: ['A', 'B'], planHash: null },
    })
    db().auditLogs.sort((a, b) => b.at.localeCompare(a.at))
    for (const format of ['CSV', 'XLSX'] as const) {
      const { header, rows } = await readyRows(format, { from: '2026-03-01T00:00:00.000Z', to: '2026-03-02T00:00:00.000Z' })
      expect(header).toEqual(COLUMNS)
      expect(rows).toEqual([
        [
          '2026-03-02 00:30:45',
          '김담당',
          '백엔드팀',
          AUDIT_ACTION_LABEL.TASK_FAILED,
          'auth-service',
          'r-main',
          't-1, t-2',
          '외부망',
          '203.0.113.10',
          '실패',
          '라벨; 사유: 이유; 본인 승인: 예; 문서 버전: 3; 실패 항목: A, B',
        ],
      ])
    }
  })

  it('요청에 프로젝트가 없으면 요청에서 찾고, 빈 칸은 그대로 비워 둔다', async () => {
    const { rows } = await readyRows('CSV', { action: 'FORBIDDEN_RULE_CONFIRMED' })
    expect(rows[0][COLUMN['프로젝트']]).toBe('')
    expect(rows[0][COLUMN['요청 ID']]).toBe('')
    expect(rows[0][COLUMN['부서']]).toBe('')
    const main = await readyRows('CSV', { requestId: 'r-main' })
    expect(main.rows[0][COLUMN['프로젝트']]).toBe('auth-service')
  })

  it('결과 열은 동작에서 끌어낸다', async () => {
    const resultOf = async (action: AuditAction) => (await readyRows('CSV', { action })).rows[0][COLUMN['결과']]
    expect(await resultOf('TASK_SUCCEEDED')).toBe('성공')
    expect(await resultOf('TASK_FAILED')).toBe('실패')
    expect(await resultOf('VERIFICATION_FAILED')).toBe('실패')
    expect(await resultOf('REJECTED')).toBe('거부')
    expect(await resultOf('KILLED')).toBe('중단')
  })

  it.each(['CSV', 'XLSX'] as const)('%s: 수식으로 시작하는 셀에 작은따옴표를 붙인다', async (format) => {
    const at = '2026-02-01T00:00:00.000Z'
    const danger = ['=1+1', '+82', '-cmd', '@SUM(A1)']
    danger.forEach((name, index) => {
      addLog({
        action: 'LOGIN',
        at,
        actor: { id: `x-${index}`, name },
        target: { label: name, requestId: name },
      })
    })
    addLog({ action: 'LOGIN', at, actor: { id: 'x-safe', name: '안전=1' }, target: { label: 'a=1' } })
    const { rows, header } = await readyRows(format, { action: 'LOGIN', from: at, to: at })
    expect(header).toEqual(COLUMNS)
    const names = rows.map((row) => row[COLUMN['행위자']])
    for (const value of danger) {
      expect(names).toContain(`'${value}`)
      expect(rows.map((row) => row[COLUMN['상세']])).toContain(`'${value}`)
      expect(rows.map((row) => row[COLUMN['요청 ID']])).toContain(`'${value}`)
    }
    expect(names).toContain('안전=1')
    expect(rows.map((row) => row[COLUMN['상세']])).toContain('a=1')
    for (const row of rows) for (const cell of row) expect(cell).not.toMatch(/^[=+\-@]/)
  })

  describe.each(['CSV', 'XLSX'] as const)('%s: 사용자 값이 들어갈 수 있는 모든 열', (format) => {
    // 시각은 서버가 만들고 결과는 동작에서 끌어내므로 사용자 값이 들어가지 않는다.
    const INJECTABLE = ['행위자', '부서', '동작', '프로젝트', '요청 ID', '작업 ID', '접속 환경', 'IP', '상세']
    const at = '2026-02-01T00:00:00.000Z'
    // XLSX는 XML에 넣을 수 없는 제어 문자를 지운다
    const stored = (value: string) => (format === 'XLSX' ? value.replaceAll('\u0001', '') : value)

    function logWith(value: string) {
      const department = { id: 'd-evil', name: value }
      db().departments.push(department)
      db().users.push({ ...db().users[0], id: 'u-evil', name: value, departmentId: department.id })
      db().projects.push({ ...db().projects[0], id: 'prj-evil', name: value })
      addLog({
        action: value as AuditAction,
        at,
        actor: { id: 'u-evil', name: value },
        target: { requestId: value, taskIds: [value], projectId: 'prj-evil', label: value },
        network: value as AuditLog['network'],
        ip: value,
      })
    }

    it.each([
      '=1+1',
      '+1+1',
      '-1+1',
      '@SUM(A1)',
      '\t=1+1',
      ' =1+1',
      '\r=1+1',
      '\n=1+1',
      '\r\n=1+1',
      ' \t\r\n =1+1',
      '\u00A0=1+1',
      '\u3000+1',
      '\u0001=1+1',
      '\uFEFF@x',
      '\u200B-1',
    ])('%j 앞에 작은따옴표를 붙이고 행이 갈라지지 않는다', async (value) => {
      logWith(value)
      const { rows, rowCount } = await readyRows(format, { from: at, to: at })
      expect(rowCount).toBe(1)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toHaveLength(COLUMNS.length)
      for (const name of INJECTABLE) expect(rows[0][COLUMN[name]], name).toBe(`'${stored(value)}`)
      expect(rows[0][COLUMN['시각(KST)']]).toBe('2026-02-01 09:00:00')
    })

    it.each(['a=1', '안전', ' abc', '\tabc', 'a\n=1+1', '1-1'])('%j는 그대로 둔다', async (value) => {
      logWith(value)
      const { rows } = await readyRows(format, { from: at, to: at })
      expect(rows).toHaveLength(1)
      for (const name of INJECTABLE) expect(rows[0][COLUMN[name]], name).toBe(value)
    })
  })

  it('CSV: 줄바꿈이 든 셀은 따옴표로 묶어 새 행을 만들지 않는다', async () => {
    const at = '2026-02-01T00:00:00.000Z'
    addLog({ action: 'LOGIN', at, target: { label: '\r\n=1+1,"x"' } })
    const { exportId } = await readyExport('CSV', { from: at, to: at })
    const bytes = new Uint8Array(await (await fileResponse(exportId)).arrayBuffer())
    expect(new TextDecoder().decode(bytes)).toContain(`"'\r\n=1+1,""x""` + `"`)
    expect(parseCsv(bytes)).toHaveLength(2)
  })

  it('CSV: UTF-8 BOM과 헤더, 따옴표 처리', async () => {
    const at = '2026-02-01T00:00:00.000Z'
    addLog({ action: 'LOGIN', at, target: { label: 'a,"b"\n한글' } })
    const { exportId } = await readyExport('CSV', { action: 'LOGIN', from: at, to: at })
    const response = await fileResponse(exportId)
    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('Content-Disposition')).toMatch(/^attachment; filename="audit-logs_20260201-20260201\.csv"$/)
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const raw = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
    expect(raw).toContain('"a,""b""\n한글"')
    expect(parseCsv(bytes)[1][COLUMN['상세']]).toBe('a,"b"\n한글')
  })

  it('XLSX: 구조가 올바르고 첫 행 고정·열 너비·필터가 있다', async () => {
    addLog({ action: 'LOGIN', at: '2026-02-01T00:00:00.000Z', target: { label: '<&>한글\u0001' } })
    const { exportId, rowCount } = await readyExport('XLSX')
    const response = await fileResponse(exportId)
    expect(response.headers.get('Content-Type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(response.headers.get('Content-Disposition')).toMatch(/^attachment; filename="audit-logs_\d{8}-\d{8}\.xlsx"$/)

    const bytes = new Uint8Array(await response.arrayBuffer())
    expect([...bytes.slice(0, 2)]).toEqual([0x50, 0x4b])
    const { files, text, sheet, rows } = readXlsx(bytes)
    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ])
    for (const part of ['/xl/workbook.xml', '/xl/worksheets/sheet1.xml', '/xl/styles.xml']) {
      expect(text('[Content_Types].xml')).toContain(`PartName="${part}"`)
    }
    expect(text('_rels/.rels')).toContain('Target="xl/workbook.xml"')
    expect(text('xl/_rels/workbook.xml.rels')).toContain('Target="worksheets/sheet1.xml"')
    expect(text('xl/workbook.xml')).toContain('name="감사 로그"')

    expect(sheet).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>')
    expect(sheet.match(/<col /g)).toHaveLength(11)
    expect(sheet).toContain('customWidth="1"')
    expect(sheet).toContain(`<autoFilter ref="A1:K${rowCount + 1}"/>`)
    expect(sheet.indexOf('</sheetData>')).toBeLessThan(sheet.indexOf('<autoFilter'))
    expect(sheet.indexOf('<cols>')).toBeLessThan(sheet.indexOf('<sheetData>'))
    expect(sheet.indexOf('<sheetViews>')).toBeLessThan(sheet.indexOf('<cols>'))

    expect(rows).toHaveLength(rowCount + 1)
    expect(rows[0]).toEqual(COLUMNS)
    expect(rows.every((row) => row.length === 11)).toBe(true)
    // 특수 문자는 이스케이프되고, XML에 넣을 수 없는 제어 문자는 빠진다
    expect(sheet).toContain('&lt;&amp;&gt;한글</t>')
    expect(sheet).not.toContain('\u0001')
    expect(rows.map((row) => row[COLUMN['상세']])).toContain('<&>한글')
  })

  it('기록이 없어도 머리글만 있는 파일을 만든다', async () => {
    for (const format of ['CSV', 'XLSX'] as const) {
      const { rowCount, header, rows } = await readyRows(format, { requestId: 'no-such-request' })
      expect(rowCount).toBe(0)
      expect(header).toEqual(COLUMNS)
      expect(rows).toEqual([])
    }
  })

  it('파일 이름은 조건의 기간을 KST로 쓴다', async () => {
    const { exportId } = await readyExport('XLSX', { from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z' })
    expect((await auditExportApi.get(exportId)).fileName).toBe('audit-logs_20261001-20261101.xlsx')
  })
})

describe('스냅샷', () => {
  it('뒤에 쌓인 기록은 파일에 들어가지 않고 건수와 항상 같다', async () => {
    const { exportId, rowCount } = await readyExport('CSV')
    addLog({ action: 'LOGIN', at: new Date(Date.now() + 1000).toISOString() })
    const rows = await rowsOf(exportId, 'CSV')
    expect(rows).toHaveLength(rowCount + 1)
    expect(await rowsOf(exportId, 'CSV')).toEqual(rows)
  })

  it('자기 자신의 감사 기록은 파일에 없고, 다음 내보내기에는 들어간다', async () => {
    const label = AUDIT_ACTION_LABEL.AUDIT_EXPORTED
    const first = await readyRows('CSV')
    expect(first.rows.some((row) => row[COLUMN['동작']] === label)).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 2))
    const second = await readyRows('XLSX')
    expect(second.rowCount).toBe(first.rowCount + 1)
    expect(second.rows.filter((row) => row[COLUMN['동작']] === label)).toHaveLength(1)
  })

  it('파일 내용은 DB에 저장하지 않는다', async () => {
    const { exportId } = await readyExport('XLSX')
    await fileResponse(exportId)
    const record = db().auditExports.find((item) => item.id === exportId)
    expect(Object.keys(record as object).sort()).toEqual(
      ['createdAt', 'expiresAt', 'fileName', 'filters', 'format', 'id', 'requesterId', 'rowCount', 'status'].sort(),
    )
    expect(JSON.stringify(record).length).toBeLessThan(500)
  })
})

describe('감사 기록', () => {
  it('AUDIT_EXPORTED에 누가·어떤 조건으로·몇 건을 남긴다', async () => {
    const filters: AuditExportFilters = { network: 'EXTERNAL', action: 'APPROVAL_SUBMITTED' }
    const { rowCount } = await auditExportApi.create({ format: 'XLSX', filters })
    const log = db().auditLogs[0]
    expect(log.action).toBe('AUDIT_EXPORTED')
    expect(log.actor).toEqual({ id: 'u-admin', name: '박CTO' })
    expect(log.network).toBe('INTERNAL')
    expect(log.detail).toEqual({ format: 'XLSX', filters, rowCount })
    expect(log.target.label).toBe(`엑셀 ${rowCount}건`)
    expect(AUDIT_ACTION_LABEL.AUDIT_EXPORTED).toBe('감사 로그 내보내기')
  })

  it('목록과 상세 라우트가 exports 경로에 가려지지 않는다', async () => {
    await auditExportApi.create({ format: 'CSV', filters: {} })
    const log = db().auditLogs[0]
    expect((await auditApi.get(log.id)).action).toBe('AUDIT_EXPORTED')
    expect((await auditApi.list({ action: 'AUDIT_EXPORTED' })).items).toHaveLength(1)
  })
})
