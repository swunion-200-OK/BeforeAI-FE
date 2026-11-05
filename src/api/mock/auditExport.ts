/** 감사 로그 내보내기 (기능 명세서 5.11, API 명세서 4.10). 파일은 저장하지 않고 내려받을 때 다시 만든다. */
import { zipSync } from 'fflate'
import { AUDIT_ACTION_LABEL, AUDIT_DETAIL_LABEL, EXPORT_FORMAT_LABEL, NETWORK_LABEL } from '../../lib/labels'
import type {
  AuditAction,
  AuditExport,
  AuditExportAccepted,
  AuditExportFilters,
  AuditLog,
  ExportFormat,
} from '../types'
import { selectAuditLogs } from './auditScope'
import { paginate, route, type Ctx, type Route } from './router'
import {
  HttpError,
  audit,
  db,
  generation,
  mockConfig,
  nextId,
  notify,
  nowIso,
  persist,
  type StoredAuditExport,
  type StoredUser,
} from './store'

const FILE_LIFETIME_MS = 60 * 60 * 1000
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8'
const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const COLUMNS = [
  { header: '시각(KST)', width: 20 },
  { header: '행위자', width: 12 },
  { header: '부서', width: 12 },
  { header: '동작', width: 20 },
  { header: '프로젝트', width: 18 },
  { header: '요청 ID', width: 18 },
  { header: '작업 ID', width: 12 },
  { header: '접속 환경', width: 10 },
  { header: 'IP', width: 16 },
  { header: '결과', width: 8 },
  { header: '상세', width: 60 },
]

const FILTER_KEYS = ['actorId', 'departmentId', 'projectId', 'requestId', 'action', 'network', 'from', 'to'] as const

// TODO(spec): 감사 로그에는 결과 값이 없다. 동작에서 끌어내고, 실패·거부·중단이 아닌 기록은 성공으로 본다.
const RESULT_BY_ACTION: Partial<Record<AuditAction, string>> = {
  VERIFICATION_FAILED: '실패',
  TASK_FAILED: '실패',
  ROLLBACK_FAILED: '실패',
  REJECTED: '거부',
  FORBIDDEN_RULE_REJECTED: '반려',
  KILLED: '중단',
  REQUEST_CANCELED: '취소',
}

// ── 행 만들기 ──────────────────────────────────────────────

const kstIso = (iso: string) => new Date(Date.parse(iso) + KST_OFFSET_MS).toISOString()
const kstDateTime = (iso: string) => kstIso(iso).slice(0, 19).replace('T', ' ')
const kstDay = (iso: string) => kstIso(iso).slice(0, 10).replaceAll('-', '')

// TODO(spec): 명세는 첫 글자만 말하지만 앞에 공백·제어 문자를 둬도 수식으로 읽힐 수 있어 함께 막는다. 백엔드도 같은 규칙이 필요하다.
const FORMULA_START = /^[\s\p{Cc}\p{Cf}]*[=+\-@]/u

/** 수식으로 실행되지 않도록 작은따옴표를 앞에 붙인다. */
function neutralizeFormula(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value
}

function detailValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? '예' : '아니요'
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value.join(', ')
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

/** 대상 이름은 맞는 열이 따로 없어 상세 앞에 붙인다. */
function describeDetail(log: AuditLog): string {
  const parts = Object.entries(log.detail)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${AUDIT_DETAIL_LABEL[key] ?? key}: ${detailValue(value)}`)
  return [log.target.label, ...parts].filter(Boolean).join('; ')
}

function toRow(log: AuditLog): string[] {
  const database = db()
  const actor = database.users.find((user) => user.id === log.actor?.id)
  const department = database.departments.find((item) => item.id === actor?.departmentId)
  const request = log.target.requestId ? database.requests.find((item) => item.id === log.target.requestId) : undefined
  const projectId = log.target.projectId ?? request?.projectId
  const row = [
    kstDateTime(log.at),
    log.actor?.name ?? '',
    department?.name ?? '',
    AUDIT_ACTION_LABEL[log.action] ?? log.action,
    database.projects.find((item) => item.id === projectId)?.name ?? '',
    log.target.requestId ?? '',
    log.target.taskIds?.join(', ') ?? '',
    log.network ? (NETWORK_LABEL[log.network] ?? log.network) : '',
    log.ip ?? '',
    RESULT_BY_ACTION[log.action] ?? '성공',
    describeDetail(log),
  ]
  return row.map(neutralizeFormula)
}

// ── CSV ────────────────────────────────────────────────────

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

function buildCsv(rows: string[][]): Uint8Array<ArrayBuffer> {
  const lines = [COLUMNS.map((column) => column.header), ...rows].map((row) => row.map(csvCell).join(','))
  return new TextEncoder().encode(`﻿${lines.join('\r\n')}\r\n`)
}

// ── XLSX ───────────────────────────────────────────────────

const SHEET_NAME = '감사 로그'
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const SHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PACKAGE_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const CONTENT_TYPE_NS = 'http://schemas.openxmlformats.org/package/2006/content-types'
const SPREADSHEET_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml'
const LAST_COLUMN = String.fromCharCode(64 + COLUMNS.length)

/** XML에 넣을 수 없는 제어 문자는 지우고 특수 문자를 이스케이프한다. */
function xmlText(value: string): string {
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\r', '&#13;')
}

function xlsxRow(cells: string[], rowNumber: number, style: number): string {
  const body = cells
    .map((value, index) => {
      const ref = `${String.fromCharCode(65 + index)}${rowNumber}`
      return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`
    })
    .join('')
  return `<row r="${rowNumber}">${body}</row>`
}

function buildXlsx(rows: string[][]): Uint8Array<ArrayBuffer> {
  const range = `A1:${LAST_COLUMN}${rows.length + 1}`
  const absoluteRange = `$A$1:$${LAST_COLUMN}$${rows.length + 1}`
  const cols = COLUMNS.map(
    (column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.width}" customWidth="1"/>`,
  ).join('')
  const sheetRows = [
    xlsxRow(COLUMNS.map((column) => column.header), 1, 1),
    ...rows.map((row, index) => xlsxRow(row, index + 2, 0)),
  ].join('')

  const parts: Record<string, string> = {
    '[Content_Types].xml': `<Types xmlns="${CONTENT_TYPE_NS}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${SPREADSHEET_TYPE}.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="${SPREADSHEET_TYPE}.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="${SPREADSHEET_TYPE}.styles+xml"/></Types>`,
    '_rels/.rels': `<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<workbook xmlns="${SHEET_NS}" xmlns:r="${REL_NS}"><sheets><sheet name="${SHEET_NAME}" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${SHEET_NAME}'!${absoluteRange}</definedName></definedNames></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': `<styleSheet xmlns="${SHEET_NS}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`,
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="${SHEET_NS}"><dimension ref="${range}"/><sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${sheetRows}</sheetData><autoFilter ref="${range}"/></worksheet>`,
  }
  const encoder = new TextEncoder()
  const files = Object.fromEntries(
    Object.entries(parts).map(([path, xml]) => [path, encoder.encode(`${XML_HEAD}${xml}`)]),
  )
  return zipSync(files) as Uint8Array<ArrayBuffer>
}

// ── 내보내기 기록 ──────────────────────────────────────────

/** createdAt 전의 기록만 쓰므로 나중에 다시 만들어도 파일 내용이 그대로다. 이 내보내기의 감사 기록도 빠진다. */
function snapshotLogs(user: StoredUser, filters: AuditExportFilters, createdAt: string): AuditLog[] {
  const query = new URLSearchParams(Object.entries(filters) as Array<[string, string]>)
  return selectAuditLogs(user, query).filter((log) => log.at < createdAt)
}

function readFilters(input: unknown): AuditExportFilters {
  const source = (input ?? {}) as Record<string, unknown>
  const filters: Record<string, string> = {}
  for (const key of FILTER_KEYS) {
    const value = source[key]
    if (typeof value === 'string' && value) filters[key] = value
  }
  for (const key of ['from', 'to']) {
    if (filters[key] && Number.isNaN(Date.parse(filters[key]))) {
      throw new HttpError(400, 'VALIDATION_ERROR', '기간 형식이 올바르지 않습니다')
    }
  }
  return filters
}

// TODO(spec): 기간 조건이 없을 때의 파일 이름은 명세에 없다. 내보낸 기록의 첫날부터 오늘까지로 쓴다.
function fileNameFor(record: Pick<StoredAuditExport, 'format' | 'filters' | 'createdAt'>, logs: AuditLog[]): string {
  const from = kstDay(record.filters.from ?? logs.at(-1)?.at ?? record.createdAt)
  const to = kstDay(record.filters.to ?? record.createdAt)
  return `audit-logs_${from}-${to}.${record.format.toLowerCase()}`
}

function toView(record: StoredAuditExport): AuditExport {
  if (record.status === 'READY' && record.expiresAt && Date.now() >= Date.parse(record.expiresAt)) {
    record.status = 'EXPIRED'
  }
  return {
    exportId: record.id,
    status: record.status,
    format: record.format,
    rowCount: record.rowCount,
    fileName: record.fileName,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    downloadUrl: record.status === 'READY' ? `/api/v1/audit-logs/exports/${record.id}/file` : null,
  }
}

function scheduleReady(exportId: string, delayMs: number) {
  const startedGeneration = generation
  setTimeout(() => {
    if (startedGeneration !== generation) return
    const record = db().auditExports.find((item) => item.id === exportId)
    if (!record || record.status !== 'PROCESSING') return
    record.status = 'READY'
    record.expiresAt = new Date(Date.now() + FILE_LIFETIME_MS).toISOString()
    // TODO(spec): 알림 설정의 어느 항목을 따를지 명세에 없다. 본인이 요청한 일의 결과라 "내 요청의 결과"를 따른다.
    notify(
      [record.requesterId],
      `감사 로그 내보내기 파일이 준비되었습니다 (${record.rowCount.toLocaleString('ko-KR')}건)`,
      '/audit',
      'requestResults',
    )
    persist()
  }, delayMs)
}

/** 새로고침으로 끊긴 준비 타이머를 남은 시간만큼 다시 건다. */
export function resumeAuditExports() {
  const database = db()
  // 이 칸을 더하기 전에 같은 스키마 버전으로 저장된 브라우저 데이터에는 값이 없다.
  database.auditExports ??= []
  for (const record of database.auditExports) {
    if (record.status !== 'PROCESSING') continue
    scheduleReady(record.id, Math.max(0, Date.parse(record.createdAt) + mockConfig.auditExportMs - Date.now()))
  }
}

// ── 라우트 ─────────────────────────────────────────────────

function createExport({ me, body }: Ctx): AuditExportAccepted {
  const format = body?.format as ExportFormat
  if (format !== 'CSV' && format !== 'XLSX') {
    throw new HttpError(400, 'VALIDATION_ERROR', '내보내기 형식은 CSV 또는 XLSX입니다')
  }
  const filters = readFilters(body?.filters)
  const createdAt = nowIso()
  const logs = snapshotLogs(me, filters, createdAt)
  const rowCount = logs.length
  const limit = mockConfig.auditExportLimit
  if (rowCount > limit) {
    throw new HttpError(422, 'EXPORT_TOO_LARGE', '내보낼 감사 로그가 너무 많습니다', { limit, rowCount })
  }
  const record: StoredAuditExport = {
    id: nextId('exp'),
    requesterId: me.id,
    format,
    filters,
    status: 'PROCESSING',
    rowCount,
    fileName: fileNameFor({ format, filters, createdAt }, logs),
    createdAt,
    expiresAt: null,
  }
  db().auditExports.unshift(record)
  audit(me, 'AUDIT_EXPORTED', { label: `${EXPORT_FORMAT_LABEL[format]} ${rowCount}건` }, { format, filters, rowCount })
  scheduleReady(record.id, mockConfig.auditExportMs)
  return { exportId: record.id, status: record.status, format, rowCount }
}

// TODO(spec): 요청자가 아닐 때의 오류 코드가 명세에 없다. 있는지 드러나지 않게 다른 조회처럼 404로 응답한다.
function ownExport({ me, params }: Ctx): StoredAuditExport {
  const record = db().auditExports.find((item) => item.id === params.exportId)
  if (!record || record.requesterId !== me.id) throw new HttpError(404, 'NOT_FOUND', '내보내기를 찾을 수 없습니다')
  return record
}

function downloadExport(ctx: Ctx): Response {
  const record = ownExport(ctx)
  const { status } = toView(record)
  // TODO(spec): 파일이 만료됐거나 아직 없을 때의 오류 코드가 명세에 없다. 상태 충돌로 보고 409 INVALID_STATE로 응답한다.
  if (status !== 'READY') {
    throw new HttpError(409, 'INVALID_STATE', '내려받을 수 있는 상태가 아닙니다', { status })
  }
  const rows = snapshotLogs(ctx.me, record.filters, record.createdAt).map(toRow)
  const csv = record.format === 'CSV'
  return new Response(csv ? buildCsv(rows) : buildXlsx(rows), {
    headers: {
      'Content-Type': csv ? CSV_CONTENT_TYPE : XLSX_CONTENT_TYPE,
      'Content-Disposition': `attachment; filename="${record.fileName}"`,
    },
  })
}

export const auditExportRoutes: Route[] = [
  // TODO(spec): 명세 예시에 POST 응답 코드가 없다. 뒤에서 처리하는 작업이라 POST /requests처럼 202로 둔다.
  route('POST', '/audit-logs/exports', createExport, { internal: true, status: 202 }),
  route(
    'GET',
    '/audit-logs/exports',
    ({ me, query }) =>
      paginate(
        db()
          .auditExports.filter((item) => item.requesterId === me.id)
          .map(toView),
        query,
      ),
    { internal: true },
  ),
  route('GET', '/audit-logs/exports/:exportId', (ctx) => toView(ownExport(ctx)), { internal: true }),
  route('GET', '/audit-logs/exports/:exportId/file', downloadExport, { internal: true }),
]
