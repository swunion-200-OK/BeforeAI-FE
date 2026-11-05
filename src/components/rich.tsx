import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/** 화면에 공통으로 쓰는 작은 부품들. */

// ── 사람 ──────────────────────────────────────────────────

function initials(name: string) {
  return name.slice(0, 1)
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const dimension = { sm: 'size-7 text-[0.75rem] tracking-tighter', md: 'size-8 text-xs', lg: 'size-10 text-sm' }[size]
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full border border-rule bg-sheet-alt font-semibold text-ink-2 ${dimension}`}
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
        <span className="block truncate text-[0.875rem] font-medium text-ink">{name}</span>
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
    <div role="tablist" aria-label={label} className="inline-flex flex-wrap gap-x-1 border-b border-rule">
      {items.map(({ id, label: text, count, icon: Icon }) => {
        const active = id === value
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(id)}
            className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-2.5 py-1.5 text-[0.875rem] whitespace-nowrap transition-colors hover:bg-sheet-alt ${
              active ? 'border-seal font-semibold text-ink' : 'border-transparent font-medium text-ink-2 hover:text-ink'
            }`}
          >
            {Icon && <Icon size={14} aria-hidden />}
            {text}
            {count !== undefined && (
              <span className="text-xs font-normal text-ink-3 tabular-nums">{count}</span>
            )}
          </button>
        )
      })}
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
          <div className="min-w-0 text-[0.875rem]">
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
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[0.875rem]">
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="text-ink-3">{item.label}</dt>
          <dd className="min-w-0 break-words text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
