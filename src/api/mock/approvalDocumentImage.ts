/** 승인 기록 문서 한 쪽을 canvas에 그려 JPEG로 만든다. 새 의존성 없이 한글을 쓰려고 브라우저 글꼴로 그린다. */
import { base64ToBytes } from '../../crypto/encoding'
import { APPROVAL_DOCUMENT_STATUS_LABEL, RISK_LABEL, TASK_STATUS_LABEL, TASK_TYPE_LABEL } from '../../lib/labels'
import type { ApprovalDocumentStatus, Risk, TaskStatus, TaskType } from '../types'

export interface DocumentBox {
  /** 이 칸이 요구하는 승인 규칙 */
  label: string
  stamp: { name: string; at: string } | null
}

export interface DocumentSlot {
  /** 화면과 같은 1부터 세는 번호 (taskNumber). order는 서버에서 0부터 시작할 수 있다 */
  number: number
  title: string
  type: TaskType
  risk: Risk
  target: string
  /** 금지 작업은 도장 칸을 두지 않는다 */
  boxes: DocumentBox[]
}

export interface ApprovalDocumentContent {
  requestId: string
  version: number
  currentVersion: number
  status: ApprovalDocumentStatus
  /** 이 판의 승인을 웹쉘이 인정하지 않았다 */
  verificationFailed: boolean
  projectName: string
  requesterName: string
  requesterDepartment: string | null
  submittedAt: string
  prompt: string
  repository: string
  baseCommit: string
  planHash: string | null
  slots: DocumentSlot[]
  /** 실행을 시작하기 전에는 비어 있다 */
  results: Array<{ number: number; title: string; status: TaskStatus }>
}

/** A4를 150dpi로 그린다. */
export const PAGE_WIDTH = 1240
export const PAGE_HEIGHT = 1754
const JPEG_QUALITY = 0.85
const MARGIN = 80
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2
const LINE_HEIGHT = 1.45
const CELL_PADDING = 16
const STAMPS_PER_ROW = 4
const BOX_HEAD_HEIGHT = 44
const BOX_BODY_HEIGHT = 156
const SEAL_RADIUS = 54
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

const INK = '#1f2937'
const MUTED = '#6b7280'
const LINE = '#d1d5db'
const HEAD_BG = '#f3f4f6'
const ACCENT = '#0a49a8'
const STAMP = '#c8321e'
const FORBIDDEN_BG = '#fdecec'

const SANS = "'IBM Plex Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans CJK KR', system-ui, sans-serif"
const MONO = "'IBM Plex Mono', ui-monospace, 'Cascadia Code', monospace"

interface TextStyle {
  size: number
  bold?: boolean
  mono?: boolean
  color?: string
  align?: CanvasTextAlign
}

const fontOf = ({ size, bold, mono }: TextStyle) => `${bold ? '700' : '400'} ${size}px ${mono ? MONO : SANS}`

/** 2026.11.05 14:30 (KST) */
function dateTime(iso: string): string {
  return new Date(Date.parse(iso) + KST_OFFSET_MS).toISOString().slice(0, 16).replaceAll('-', '.').replace('T', ' ')
}

/** 한글은 어디서나 끊을 수 있어 글자 단위로 재되, 같은 줄에 공백이 있으면 거기서 끊는다. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const char of paragraph) {
      if (ctx.measureText(line + char).width <= width || line === '') {
        line += char
        continue
      }
      const space = line.lastIndexOf(' ')
      lines.push(space > 0 ? line.slice(0, space) : line)
      line = (space > 0 ? line.slice(space + 1) : '') + char
    }
    lines.push(line)
  }
  return lines
}

/** 다 그린 높이를 돌려준다. 쪽을 넘으면 부르는 쪽이 줄여서 다시 그린다. */
export function paintApprovalDocument(ctx: CanvasRenderingContext2D, doc: ApprovalDocumentContent): number {
  ctx.textBaseline = 'top'

  const put = (text: string, x: number, top: number, style: TextStyle) => {
    ctx.font = fontOf(style)
    ctx.fillStyle = style.color ?? INK
    ctx.textAlign = style.align ?? 'left'
    ctx.fillText(text, x, top)
  }
  const linesOf = (text: string, width: number, style: TextStyle) => {
    ctx.font = fontOf(style)
    return wrap(ctx, text, width)
  }
  const heightOf = (lines: string[], style: TextStyle) => Math.ceil(lines.length * style.size * LINE_HEIGHT)
  const putLines = (lines: string[], x: number, top: number, style: TextStyle) => {
    lines.forEach((line, index) => put(line, x, top + index * style.size * LINE_HEIGHT, style))
    return heightOf(lines, style)
  }
  const box = (x: number, top: number, width: number, height: number, fill?: string) => {
    if (fill) {
      ctx.fillStyle = fill
      ctx.fillRect(x, top, width, height)
    }
    ctx.strokeStyle = LINE
    ctx.lineWidth = 2
    ctx.strokeRect(x, top, width, height)
  }

  let y = 72

  // ── 머리 ──
  put('승인 기록 문서', PAGE_WIDTH / 2, y, { size: 56, bold: true, align: 'center' })
  y += 80
  const statusLabel = APPROVAL_DOCUMENT_STATUS_LABEL[doc.status]
  const superseded = doc.status === 'SUPERSEDED' ? ` (최신은 제 ${doc.currentVersion}판)` : ''
  const failed = doc.verificationFailed ? ' (웹쉘 검증 실패)' : ''
  put(`제 ${doc.version}판 · ${statusLabel}${superseded}${failed}`, PAGE_WIDTH / 2, y, { size: 26, bold: true, color: doc.verificationFailed ? STAMP : MUTED, align: 'center' })
  y += 64

  // ── 기본 정보 ──
  const requester = doc.requesterDepartment ? `${doc.requesterName} (${doc.requesterDepartment})` : doc.requesterName
  const rows: Array<[string, string, string, string]> = [
    ['요청자', requester, '프로젝트', doc.projectName],
    ['제출 시각', `${dateTime(doc.submittedAt)} KST`, '판', `제 ${doc.version}판 / 전체 ${doc.currentVersion}판`],
    ['저장소', doc.repository, '기준 커밋', doc.baseCommit],
  ]
  const labelWidth = 140
  const halfWidth = CONTENT_WIDTH / 2
  const valueWidth = halfWidth - labelWidth - CELL_PADDING * 2
  const valueStyle: TextStyle = { size: 24 }
  const labelStyle: TextStyle = { size: 22, bold: true, color: MUTED }
  for (const [labelA, valueA, labelB, valueB] of rows) {
    const linesA = linesOf(valueA, valueWidth, valueStyle)
    const linesB = linesOf(valueB, valueWidth, valueStyle)
    const height = Math.max(heightOf(linesA, valueStyle), heightOf(linesB, valueStyle)) + CELL_PADDING * 2
    ;[
      { x: MARGIN, label: labelA, lines: linesA },
      { x: MARGIN + halfWidth, label: labelB, lines: linesB },
    ].forEach(({ x, label, lines }) => {
      box(x, y, labelWidth, height, HEAD_BG)
      box(x + labelWidth, y, halfWidth - labelWidth, height)
      put(label, x + CELL_PADDING, y + CELL_PADDING, labelStyle)
      putLines(lines, x + labelWidth + CELL_PADDING, y + CELL_PADDING, valueStyle)
    })
    y += height
  }

  const sectionTitle = (title: string) => {
    y += 36
    put(`■ ${title}`, MARGIN, y, { size: 30, bold: true, color: ACCENT })
    y += 52
  }

  // ── 요청 내용 ──
  sectionTitle('요청 내용')
  const promptStyle: TextStyle = { size: 26 }
  const promptLines = linesOf(doc.prompt, CONTENT_WIDTH - CELL_PADDING * 2, promptStyle)
  const promptHeight = heightOf(promptLines, promptStyle) + CELL_PADDING * 2
  box(MARGIN, y, CONTENT_WIDTH, promptHeight)
  putLines(promptLines, MARGIN + CELL_PADDING, y + CELL_PADDING, promptStyle)
  y += promptHeight

  // ── 결재란 ──
  sectionTitle('결재란')
  const infoWidth = Math.round(CONTENT_WIDTH * 0.38)
  const stampsWidth = CONTENT_WIDTH - infoWidth
  const titleStyle: TextStyle = { size: 26, bold: true }
  const metaStyle: TextStyle = { size: 22, color: MUTED }
  for (const slot of doc.slots) {
    const infoInner = infoWidth - CELL_PADDING * 2
    const titleLines = linesOf(`#${slot.number} ${slot.title}`, infoInner, titleStyle)
    const metaLines = [
      ...linesOf(`${TASK_TYPE_LABEL[slot.type]} · 위험도 ${RISK_LABEL[slot.risk]}`, infoInner, metaStyle),
      ...linesOf(`대상 ${slot.target}`, infoInner, metaStyle),
    ]
    const forbidden = slot.risk === 'FORBIDDEN'
    const columns = Math.max(1, Math.min(slot.boxes.length, STAMPS_PER_ROW))
    const stampRows = forbidden ? 0 : Math.ceil(slot.boxes.length / columns)
    const stampsHeight = stampRows * (BOX_HEAD_HEIGHT + BOX_BODY_HEIGHT)
    const height = Math.max(heightOf(titleLines, titleStyle) + heightOf(metaLines, metaStyle), stampsHeight, 44) + CELL_PADDING * 2

    box(MARGIN, y, infoWidth, height, HEAD_BG)
    const titleHeight = putLines(titleLines, MARGIN + CELL_PADDING, y + CELL_PADDING, titleStyle)
    putLines(metaLines, MARGIN + CELL_PADDING, y + CELL_PADDING + titleHeight, metaStyle)

    const stampsX = MARGIN + infoWidth
    box(stampsX, y, stampsWidth, height, forbidden ? FORBIDDEN_BG : undefined)
    if (forbidden) {
      put('금지 작업: 결재·실행 대상이 아닙니다', stampsX + stampsWidth / 2, y + height / 2 - 14, { size: 24, bold: true, color: STAMP, align: 'center' })
    } else {
      const columnWidth = (stampsWidth - CELL_PADDING * 2) / columns
      slot.boxes.forEach(({ label, stamp }, index) => {
        const x = stampsX + CELL_PADDING + (index % columns) * columnWidth
        const top = y + CELL_PADDING + Math.floor(index / columns) * (BOX_HEAD_HEIGHT + BOX_BODY_HEIGHT)
        const center = x + columnWidth / 2
        box(x, top, columnWidth, BOX_HEAD_HEIGHT, HEAD_BG)
        box(x, top + BOX_HEAD_HEIGHT, columnWidth, BOX_BODY_HEIGHT)
        put(linesOf(label, columnWidth - 8, { size: 20 })[0], center, top + 10, { size: 20, bold: true, color: MUTED, align: 'center' })
        if (!stamp) {
          put('대기', center, top + BOX_HEAD_HEIGHT + BOX_BODY_HEIGHT / 2 - 12, { size: 24, color: MUTED, align: 'center' })
          return
        }
        drawSeal(ctx, stamp.name, center, top + BOX_HEAD_HEIGHT + 68)
        put(dateTime(stamp.at).slice(5), center, top + BOX_HEAD_HEIGHT + BOX_BODY_HEIGHT - 30, { size: 20, color: MUTED, align: 'center' })
      })
    }
    y += height
  }

  // ── 실행 결과 ──
  if (doc.results.length > 0) {
    sectionTitle('실행 결과')
    const statusWidth = 200
    const resultStyle: TextStyle = { size: 24 }
    for (const result of doc.results) {
      const lines = linesOf(`#${result.number} ${result.title}`, CONTENT_WIDTH - statusWidth - CELL_PADDING * 2, resultStyle)
      const height = heightOf(lines, resultStyle) + CELL_PADDING * 2
      box(MARGIN, y, CONTENT_WIDTH - statusWidth, height)
      box(MARGIN + CONTENT_WIDTH - statusWidth, y, statusWidth, height, HEAD_BG)
      putLines(lines, MARGIN + CELL_PADDING, y + CELL_PADDING, resultStyle)
      put(TASK_STATUS_LABEL[result.status], MARGIN + CONTENT_WIDTH - statusWidth / 2, y + CELL_PADDING, { ...resultStyle, bold: true, align: 'center' })
      y += height
    }
  }

  // ── 서명 대상 ──
  sectionTitle('서명 대상')
  const hashStyle: TextStyle = { size: 24, mono: true }
  const noteStyle: TextStyle = { size: 22, color: MUTED }
  const inner = CONTENT_WIDTH - CELL_PADDING * 2
  const hashLines = linesOf(doc.planHash ?? '-', inner, hashStyle)
  const noteLines = linesOf('승인 서명은 이 문서가 아니라 위 Plan 해시에 합니다. 이 문서는 승인 기록을 확인하기 위한 사본입니다.', inner, noteStyle)
  const hashHeight = 40 + heightOf(hashLines, hashStyle) + 12 + heightOf(noteLines, noteStyle) + CELL_PADDING * 2
  box(MARGIN, y, CONTENT_WIDTH, hashHeight, HEAD_BG)
  put('Plan 해시', MARGIN + CELL_PADDING, y + CELL_PADDING, labelStyle)
  const hashTop = y + CELL_PADDING + 40
  const hashBlock = putLines(hashLines, MARGIN + CELL_PADDING, hashTop, hashStyle)
  putLines(noteLines, MARGIN + CELL_PADDING, hashTop + hashBlock + 12, noteStyle)
  y += hashHeight

  y += 24
  put(`요청 ${doc.requestId}`, MARGIN, y, { size: 20, color: MUTED })
  return y + 20 + MARGIN
}

function drawSeal(ctx: CanvasRenderingContext2D, name: string, x: number, y: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate((-6 * Math.PI) / 180)
  ctx.strokeStyle = STAMP
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.arc(0, 0, SEAL_RADIUS, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = STAMP
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // 이름이 길어도 도장 안에 들어가게 줄인다.
  const room = SEAL_RADIUS * 1.6
  ctx.font = fontOf({ size: 30, bold: true })
  const size = Math.max(16, Math.min(30, Math.floor((30 * room) / Math.max(1, ctx.measureText(name).width))))
  ctx.font = fontOf({ size, bold: true })
  ctx.fillText(name, 0, 0)
  ctx.restore()
}

/** canvas의 toDataURL은 동기라 목 라우트 안에서 바로 쓸 수 있다. 내용이 쪽을 넘으면 잘라 내지 않고 전체를 줄인다. */
export function renderApprovalDocumentJpeg(doc: ApprovalDocumentContent): Uint8Array {
  const canvas = document.createElement('canvas')
  canvas.width = PAGE_WIDTH
  canvas.height = PAGE_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas를 쓸 수 없습니다')
  const clear = () => {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT)
  }
  clear()
  const used = paintApprovalDocument(ctx, doc)
  if (used > PAGE_HEIGHT) {
    clear()
    const scale = PAGE_HEIGHT / used
    ctx.setTransform(scale, 0, 0, scale, (PAGE_WIDTH * (1 - scale)) / 2, 0)
    paintApprovalDocument(ctx, doc)
  }
  return base64ToBytes(canvas.toDataURL('image/jpeg', JPEG_QUALITY).split(',')[1])
}
