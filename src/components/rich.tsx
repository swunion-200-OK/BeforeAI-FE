import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { RequestTaskSummary, Risk } from '../api/types'
import { RISK_EMOJI, RISK_LABEL } from '../lib/labels'

/** 화면을 풍부하고 한눈에 보이게 만드는 작은 부품들. */

// ── 사람·프로젝트 ──────────────────────────────────────────

const AVATAR_COLORS = [
  'bg-[#dfe7ff] text-[#23389f]',
  'bg-[#d8f3f5] text-[#08616a]',
  'bg-[#f1ebff] text-[#4f2aa8]',
  'bg-[#ffefd6] text-[#8f4800]',
  'bg-[#dcf6ea] text-[#0b6245]',
  'bg-[#fde6ee] text-[#a2214f]',
]

function hash(text: string) {
  let value = 0
  for (const char of text) value = (value * 31 + char.charCodeAt(0)) >>> 0
  return value
}

function initials(name: string) {
  // 세 글자 한글 이름은 이름 두 글자로, 그 밖에는 첫 글자로 쓴다.
  return /^[가-힣]{3}$/.test(name) ? name.slice(1) : name.slice(0, 1)
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const dimension = { sm: 'size-7 text-[0.6875rem] tracking-tighter', md: 'size-8 text-xs', lg: 'size-10 text-sm' }[size]
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${dimension} ${
        AVATAR_COLORS[hash(name) % AVATAR_COLORS.length]
      }`}
    >
      {initials(name)}
    </span>
  )
}

export function UserChip({ name, sub, size = 'sm' }: { name: string; sub?: ReactNode; size?: 'sm' | 'md' }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <Avatar name={name} size={size} />
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[0.8125rem] font-medium text-ink">{name}</span>
        {sub && <span className="block truncate text-xs text-ink-3">{sub}</span>}
      </span>
    </span>
  )
}

/** 여러 사람을 겹쳐 보여 준다. */
export function AvatarStack({ names, max = 4 }: { names: string[]; max?: number }) {
  const shown = names.slice(0, max)
  return (
    <span className="inline-flex items-center" aria-label={names.join(', ')}>
      {shown.map((name, index) => (
        <span key={name} className={`rounded-full ring-2 ring-sheet ${index > 0 ? '-ml-1' : ''}`}>
          <Avatar name={name} size="sm" />
        </span>
      ))}
      {names.length > max && <span className="ml-1 text-xs text-ink-3">+{names.length - max}</span>}
    </span>
  )
}

export function ProjectTag({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[0.8125rem] whitespace-nowrap text-ink-2">
      <span aria-hidden className={`size-2 rounded-sm ${['bg-seal', 'bg-internal', 'bg-ai', 'bg-medium'][hash(name) % 4]}`} />
      {name}
    </span>
  )
}

// ── 숫자 카드 ──────────────────────────────────────────────

const STAT_TONE = {
  seal: 'bg-seal-soft text-seal',
  ai: 'bg-ai-soft text-ai',
  live: 'bg-internal-soft text-internal',
  green: 'bg-low-soft text-low',
  amber: 'bg-medium-soft text-medium',
  red: 'bg-high-soft text-high',
  neutral: 'bg-forbidden-soft text-forbidden',
} as const

export type StatTone = keyof typeof STAT_TONE

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'seal',
  to,
  alert,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon: LucideIcon
  tone?: StatTone
  /** 누르면 해당 목록으로 이동 */
  to?: string
  /** 처리가 필요한 값이면 테두리로 눈에 띄게 한다 */
  alert?: boolean
}) {
  const body = (
    <>
      <span className={`inline-flex size-10 shrink-0 items-center justify-center rounded-lg ${STAT_TONE[tone]}`}>
        <Icon size={20} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-[0.8125rem] text-ink-2">{label}</span>
        <span className="block text-[1.625rem] leading-tight font-bold tracking-tight tabular-nums">{value}</span>
        {hint && <span className="mt-0.5 block truncate text-xs text-ink-3">{hint}</span>}
      </span>
    </>
  )
  const className = `flex items-center gap-3 rounded-xl border bg-sheet p-3.5 shadow-card ${
    alert ? 'border-high/50' : 'border-rule'
  }`
  return to ? (
    <Link to={to} className={`${className} transition-colors hover:border-seal/50 hover:bg-seal-soft/30`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  )
}

// ── 필터 탭 ────────────────────────────────────────────────

export function SegmentedTabs<T extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: Array<{ id: T; label: string; count?: number; icon?: LucideIcon }>
  value: T
  onChange: (id: T) => void
  label: string
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-lg bg-[#e7ebf3] p-1">
      {items.map(({ id, label: text, count, icon: Icon }) => {
        const active = id === value
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(id)}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[0.8125rem] font-medium whitespace-nowrap ${
              active ? 'bg-sheet text-ink shadow-card' : 'text-ink-2 hover:text-ink'
            }`}
          >
            {Icon && <Icon size={14} aria-hidden />}
            {text}
            {count !== undefined && (
              <span className={`rounded px-1 text-xs tabular-nums ${active ? 'bg-seal-soft text-seal-dark' : 'text-ink-3'}`}>
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ── 위험도·진행 요약 ───────────────────────────────────────

/** 위험도별 작업 수를 이모지 + 글자 + 숫자로 짧게 쓴다. 색만으로 구분하지 않는다. */
export function RiskSummary({ risks }: { risks: Record<Risk, number> }) {
  const order: Risk[] = ['FORBIDDEN', 'HIGH', 'MEDIUM', 'LOW']
  const shown = order.filter((risk) => risks[risk] > 0)
  if (shown.length === 0) return <span className="text-xs text-ink-3">작업 없음</span>
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs whitespace-nowrap text-ink-2">
      {shown.map((risk) => (
        <span key={risk} className="inline-flex items-center gap-1">
          <span aria-hidden className="text-[0.625rem]">
            {RISK_EMOJI[risk]}
          </span>
          {RISK_LABEL[risk]} {risks[risk]}
        </span>
      ))}
    </span>
  )
}

/** 승인·실행 진행을 칸으로 보여 준다. 칸마다 작업 하나다. */
export function TaskProgress({ summary }: { summary: RequestTaskSummary }) {
  const pips = Array.from({ length: summary.required }, (_, index) => {
    if (index < summary.succeeded) return 'bg-low'
    if (index < summary.succeeded + summary.failed) return 'bg-high'
    if (index < summary.approved) return 'bg-seal'
    return 'bg-rule-strong'
  })
  const text =
    summary.succeeded + summary.failed > 0
      ? `실행 ${summary.succeeded + summary.failed}/${summary.required}`
      : `승인 ${summary.approved}/${summary.required}`
  return (
    <span className="inline-flex items-center gap-2" title={text}>
      <span aria-hidden className="inline-flex gap-0.5">
        {pips.map((color, index) => (
          <span key={index} className={`h-1.5 w-4 rounded-full ${color}`} />
        ))}
      </span>
      <span className="text-xs whitespace-nowrap text-ink-3 tabular-nums">{text}</span>
    </span>
  )
}

export function Meter({ value, max, className = 'bg-seal' }: { value: number; max: number; className?: string }) {
  const width = max > 0 ? Math.max(value > 0 ? 3 : 0, (value / max) * 100) : 0
  return (
    <span aria-hidden className="block h-2 w-full overflow-hidden rounded-full bg-paper">
      <span className={`block h-full rounded-full ${className}`} style={{ width: `${width}%` }} />
    </span>
  )
}

/** 도넛 차트. 칸 사이를 벌려 색이 달라 보이지 않아도 구분된다. 글자 범례와 함께 쓴다. */
export function Donut({
  segments,
  center,
  size = 132,
}: {
  segments: Array<{ value: number; color: string; label: string }>
  center?: ReactNode
  size?: number
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0)
  const radius = 42
  const circumference = 2 * Math.PI * radius
  const shown = segments.filter((segment) => segment.value > 0)
  const gap = shown.length > 1 ? 2 : 0
  const arcs = shown.map((segment, index) => {
    const before = shown.slice(0, index).reduce((sum, item) => sum + item.value, 0)
    return { ...segment, length: (segment.value / total) * circumference, start: (before / total) * circumference }
  })
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" role="img" aria-label={segments.map((s) => `${s.label} ${s.value}건`).join(', ')}>
        <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--color-paper)" strokeWidth="11" />
        {arcs.map((arc) => (
          <circle
            key={arc.label}
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke={arc.color}
            strokeWidth="11"
            strokeDasharray={`${Math.max(arc.length - gap, 0.5)} ${circumference}`}
            strokeDashoffset={-arc.start}
          />
        ))}
      </svg>
      {center && <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{center}</div>}
    </div>
  )
}

// ── 세로 타임라인 ──────────────────────────────────────────

export function Timeline({
  items,
}: {
  items: Array<{ key: string; title: ReactNode; meta?: ReactNode; tone?: 'done' | 'current' | 'error' | 'todo' }>
}) {
  const DOT = {
    done: 'bg-seal',
    current: 'bg-sheet ring-2 ring-seal',
    error: 'bg-high',
    todo: 'bg-rule-strong',
  }
  return (
    <ol className="flex flex-col">
      {items.map((item, index) => (
        <li key={item.key} className="relative flex gap-3 pb-3 last:pb-0">
          {index < items.length - 1 && (
            <span aria-hidden className="absolute top-3 bottom-0 left-[4.5px] w-px bg-rule-strong" />
          )}
          <span aria-hidden className={`relative mt-1.5 size-2.5 shrink-0 rounded-full ${DOT[item.tone ?? 'done']}`} />
          <div className="min-w-0 text-[0.8125rem]">
            <div className="font-medium text-ink">{item.title}</div>
            {item.meta && <div className="text-xs text-ink-3">{item.meta}</div>}
          </div>
        </li>
      ))}
    </ol>
  )
}

export function KeyValues({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[0.8125rem]">
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="text-ink-3">{item.label}</dt>
          <dd className="min-w-0 break-words text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
