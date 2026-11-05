import type { AuditAction, AuditExport, AuditExportFilters, Network } from '../../api/types'
import { formatDateTime } from '../../lib/format'
import { AUDIT_ACTION_LABEL, EXPORT_FORMAT_LABEL, EXPORT_STATUS_LABEL, NETWORK_LABEL } from '../../lib/labels'

type Named = { id: string; name: string }

function localDay(iso: string): string {
  const date = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function periodText(from?: string, to?: string): string | undefined {
  const start = from && localDay(from)
  const end = to && localDay(to)
  if (start && end) return start === end ? start : `${start} ~ ${end}`
  if (start) return `${start}부터`
  return end ? `${end}까지` : undefined
}

/** 주소가 아니라 서버로 보낼 값에서 만들어, 화면의 조건과 실제로 적용되는 조건이 어긋나지 않게 한다. */
export function describeConditions(
  filters: AuditExportFilters,
  names: { actors?: Named[]; departments?: Named[]; projects?: Named[] },
): Array<{ label: string; value: string }> {
  const nameOf = (list: Named[] | undefined, id: string) => list?.find((item) => item.id === id)?.name ?? id
  const { actorId, departmentId, projectId, requestId, action, network } = filters
  const rows: Array<{ label: string; value: string | undefined }> = [
    { label: '기간', value: periodText(filters.from, filters.to) },
    { label: '사용자', value: actorId ? nameOf(names.actors, actorId) : undefined },
    { label: '부서', value: departmentId ? nameOf(names.departments, departmentId) : undefined },
    { label: '프로젝트', value: projectId ? nameOf(names.projects, projectId) : undefined },
    { label: '요청 ID', value: requestId },
    { label: '액션', value: action ? (AUDIT_ACTION_LABEL[action as AuditAction] ?? action) : undefined },
    { label: '접속 환경', value: network ? NETWORK_LABEL[network as Network] : undefined },
  ]
  return rows.filter((row): row is { label: string; value: string } => Boolean(row.value))
}

export const rowCountText = (count?: number) => (count === undefined ? '' : `${count.toLocaleString('ko-KR')}건`)

/** 명세에 없거나 형식이 다른 시각은 빼고 보여 준다. formatDateTime은 잘못된 날짜에서 예외를 던진다. */
export function timeText(iso?: string | null): string | null {
  return iso && !Number.isNaN(Date.parse(iso)) ? formatDateTime(iso) : null
}

const joinParts = (...parts: Array<string | null | undefined>) => parts.filter(Boolean).join(' · ')

export function exportSummary(item: Partial<AuditExport>): string {
  return joinParts(item.format && EXPORT_FORMAT_LABEL[item.format], rowCountText(item.rowCount))
}

export function exportMeta(item: Partial<AuditExport> & Pick<AuditExport, 'status'>): string {
  return joinParts(timeText(item.createdAt), EXPORT_STATUS_LABEL[item.status] ?? item.status)
}

export function exportFileName(item: Partial<AuditExport> & Pick<AuditExport, 'exportId'>): string {
  if (item.fileName) return item.fileName
  return item.format ? `audit-logs-${item.exportId}.${item.format.toLowerCase()}` : `audit-logs-${item.exportId}`
}
