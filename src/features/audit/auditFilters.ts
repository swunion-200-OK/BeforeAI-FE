import type { AuditLogQuery, Network } from '../../api/types'

export const FILTER_KEYS = [
  'actorId',
  'departmentId',
  'projectId',
  'requestId',
  'action',
  'network',
  'from',
  'to',
] as const

export type FilterKey = (typeof FILTER_KEYS)[number]

export function hasFilters(params: URLSearchParams): boolean {
  return FILTER_KEYS.some((key) => params.get(key))
}

/** 날짜 입력은 사용자의 현지 날짜다. 서버에는 그날의 시작과 끝을 ISO로 보낸다. */
function dayBoundary(day: string | null, time: string): string | undefined {
  if (!day) return undefined
  const date = new Date(`${day}T${time}`)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

export function toAuditQuery(params: URLSearchParams): AuditLogQuery {
  const network = params.get('network')
  return {
    actorId: params.get('actorId') ?? undefined,
    departmentId: params.get('departmentId') ?? undefined,
    projectId: params.get('projectId') ?? undefined,
    requestId: params.get('requestId') ?? undefined,
    action: params.get('action') ?? undefined,
    network: network === 'INTERNAL' || network === 'EXTERNAL' ? (network as Network) : undefined,
    from: dayBoundary(params.get('from'), '00:00:00'),
    to: dayBoundary(params.get('to'), '23:59:59.999'),
  }
}
