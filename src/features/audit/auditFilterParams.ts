import { USE_MOCK } from '../../api/client'
import type { AuditAction, AuditLogQuery, Network } from '../../api/types'

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 서버의 ID 조건은 UUID라서 다른 값은 400이고, 다시 불러와도 같다. 목의 ID(r-main 등)는 UUID가 아니어서 목에서는 검사하지 않는다. */
export function isRequestIdFilter(value: string, mock = USE_MOCK): boolean {
  return mock || UUID.test(value)
}

const ID_KEYS: FilterKey[] = ['actorId', 'departmentId', 'projectId', 'requestId']

export function countFilters(params: URLSearchParams): number {
  // 내보내기와 목록에 실제로 적용되는 조건만 센다. 날짜가 아닌 값이나 형식이 틀린 요청 ID는 적용되지 않는다.
  return FILTER_KEYS.filter((key) => {
    const value = params.get(key)
    if (!value) return false
    if (ID_KEYS.includes(key)) return isRequestIdFilter(value)
    return key === 'from' || key === 'to' ? Boolean(dayBoundary(value, '00:00:00')) : true
  }).length
}

/** 날짜 입력은 사용자의 현지 날짜다. 서버에는 그날의 시작과 끝을 ISO로 보낸다. */
function dayBoundary(day: string | null, time: string): string | undefined {
  if (!day) return undefined
  const date = new Date(`${day}T${time}`)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

export function toAuditQuery(params: URLSearchParams): AuditLogQuery {
  const network = params.get('network')
  const id = (key: FilterKey) => {
    const value = params.get(key)
    return value && isRequestIdFilter(value) ? value : undefined
  }
  return {
    actorId: id('actorId'),
    departmentId: id('departmentId'),
    projectId: id('projectId'),
    requestId: id('requestId'),
    action: params.get('action') ?? undefined,
    network: network === 'INTERNAL' || network === 'EXTERNAL' ? (network as Network) : undefined,
    from: dayBoundary(params.get('from'), '00:00:00'),
    to: dayBoundary(params.get('to'), '23:59:59.999'),
  }
}

const DANGER_ACTIONS: AuditAction[] = ['VERIFICATION_FAILED', 'TASK_FAILED', 'KILLED', 'REJECTED', 'ROLLBACK_FAILED']

/** 표에서 먼저 눈에 들어와야 하는 액션 */
export function isDangerAction(action: AuditAction): boolean {
  return DANGER_ACTIONS.includes(action)
}

function today(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export type QuickFilterId = 'external-approval' | 'verification-failed' | 'today'

export const QUICK_FILTERS: Array<{
  id: QuickFilterId
  label: string
  values: () => Partial<Record<FilterKey, string>>
}> = [
  {
    id: 'external-approval',
    label: '외부망 승인',
    values: () => ({ network: 'EXTERNAL', action: 'APPROVAL_SUBMITTED' }),
  },
  { id: 'verification-failed', label: '검증 실패', values: () => ({ action: 'VERIFICATION_FAILED' }) },
  {
    id: 'today',
    label: '오늘',
    values: () => ({ from: today(), to: today() }),
  },
]

export function isQuickFilterActive(id: QuickFilterId, params: URLSearchParams): boolean {
  const filter = QUICK_FILTERS.find((item) => item.id === id)
  if (!filter) return false
  return Object.entries(filter.values()).every(([key, value]) => params.get(key) === value)
}

/** 빠른 필터를 켜거나 끈다. 다른 필터 값은 건드리지 않는다. */
export function toggleQuickFilter(id: QuickFilterId, params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params)
  const filter = QUICK_FILTERS.find((item) => item.id === id)
  if (!filter) return next
  const active = isQuickFilterActive(id, params)
  for (const [key, value] of Object.entries(filter.values())) {
    if (active) next.delete(key)
    else next.set(key, value)
  }
  return next
}
