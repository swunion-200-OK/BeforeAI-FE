import { CircleAlert, Info, Loader2, ShieldAlert, TriangleAlert, X } from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { INTERNAL_ONLY_MESSAGE } from '../api/errors'
import { useIsExternal } from '../lib/queries'
import { refreshToastHost } from './toast'

// ── 버튼 ───────────────────────────────────────────────────

const BUTTON_VARIANT = {
  primary: 'bg-seal text-white hover:bg-seal-dark disabled:bg-rule-strong',
  secondary: 'border border-rule-strong bg-sheet text-ink hover:bg-sheet-alt disabled:text-ink-3 disabled:bg-sheet-alt',
  danger: 'bg-high text-white hover:brightness-90 disabled:bg-rule-strong',
  'danger-outline': 'border border-high bg-sheet text-high hover:bg-high-soft disabled:border-rule-strong disabled:text-ink-3',
  ghost: 'text-ink-2 hover:bg-paper disabled:text-ink-3',
} as const

const BUTTON_SIZE = {
  sm: 'h-8 px-2.5 text-[0.8125rem] gap-1',
  md: 'h-9 px-3.5 text-sm gap-1.5',
  lg: 'h-11 px-5 text-[0.9375rem] gap-2',
} as const

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof BUTTON_VARIANT
  size?: keyof typeof BUTTON_SIZE
  loading?: boolean
  /** 외부망이면 비활성화하고 "내부망에서만 가능한 기능입니다" 툴팁을 띄운다 */
  internalOnly?: boolean
  /** 비활성화 이유를 보여 줄 툴팁 */
  disabledReason?: string | null
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  internalOnly,
  disabledReason,
  disabled,
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const external = useIsExternal()
  const blockedByNetwork = internalOnly && external
  const reason = blockedByNetwork ? INTERNAL_ONLY_MESSAGE : disabled ? disabledReason : null
  const button = (
    <button
      type={type}
      disabled={disabled || loading || blockedByNetwork}
      className={`inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]} ${className}`}
      {...rest}
    >
      {loading && <Loader2 size={15} className="animate-spin" aria-hidden />}
      {children}
    </button>
  )
  return reason ? <Tooltip text={reason}>{button}</Tooltip> : button
}

// ── 툴팁 ───────────────────────────────────────────────────

/** disabled 버튼은 포커스를 못 받으므로 감싸는 span이 포커스를 받는다. */
export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <span className="group/tooltip relative inline-flex" tabIndex={0} role="group" aria-label={text}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 hidden w-max max-w-64 -translate-x-1/2 rounded bg-ink px-2 py-1 text-xs font-normal text-white group-hover/tooltip:block group-focus/tooltip:block"
      >
        {text}
      </span>
    </span>
  )
}

// ── 입력 ───────────────────────────────────────────────────

const INPUT_CLASS =
  'w-full rounded-md border border-rule-strong bg-sheet px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-3 focus:border-seal focus:outline-none focus:ring-1 focus:ring-seal disabled:bg-sheet-alt disabled:text-ink-3'

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: ReactNode
  error?: string | null
  children: (id: string) => ReactNode
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[0.8125rem] font-medium text-ink-2">
        {label}
      </label>
      {children(id)}
      {hint && !error && <p className="text-xs text-ink-3">{hint}</p>}
      {error && <p className="text-xs text-high">{error}</p>}
    </div>
  )
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${INPUT_CLASS} ${props.className ?? ''}`} />
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${INPUT_CLASS} ${props.className ?? ''}`} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${INPUT_CLASS} ${props.className ?? ''}`} />
}

// ── 안내 ───────────────────────────────────────────────────

const BANNER_TONE = {
  info: { box: 'border-seal/30 bg-seal-soft text-seal-dark', Icon: Info },
  warning: { box: 'border-medium/40 bg-medium-soft text-medium', Icon: TriangleAlert },
  danger: { box: 'border-high/50 bg-high-soft text-high', Icon: ShieldAlert },
  neutral: { box: 'border-rule bg-sheet-alt text-ink-2', Icon: Info },
} as const

export function Banner({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: keyof typeof BANNER_TONE
  title?: ReactNode
  children?: ReactNode
  action?: ReactNode
}) {
  const { box, Icon } = BANNER_TONE[tone]
  return (
    <div className={`flex items-start gap-2.5 rounded-md border px-3.5 py-2.5 text-sm ${box}`} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon size={18} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function Spinner({ label = '불러오는 중' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-ink-3" role="status">
      <Loader2 size={18} className="animate-spin" aria-hidden />
      {label}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <CircleAlert size={24} className="text-high" aria-hidden />
      <p className="text-sm text-ink-2">{error instanceof Error ? error.message : '불러오지 못했습니다'}</p>
      {onRetry && <Button onClick={onRetry}>다시 불러오기</Button>}
    </div>
  )
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="font-medium text-ink-2">{title}</p>
      {children && <p className="max-w-md text-sm text-ink-3">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

// ── 페이지 구조 ────────────────────────────────────────────

export function PageHeader({
  title,
  description,
  actions,
  meta,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  meta?: ReactNode
}) {
  return (
    <header className="mb-4 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-[1.5rem] font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 max-w-[80ch] text-sm text-ink-2">{description}</p>}
        {meta && <div className="mt-2 flex flex-wrap items-center gap-2 text-[0.8125rem] text-ink-2">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

/** 흰 서류 한 장. 안쪽 여백을 직접 정하고 싶으면 flush를 준다. */
export function Sheet({
  title,
  icon,
  actions,
  children,
  flush,
  className = '',
}: {
  title?: ReactNode
  /** 제목 앞 아이콘 */
  icon?: ReactNode
  actions?: ReactNode
  children: ReactNode
  flush?: boolean
  className?: string
}) {
  return (
    <section className={`rounded-xl border border-rule bg-sheet shadow-card ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-2.5">
          {title && (
            <h2 className="flex items-center gap-2 text-[0.9375rem] font-semibold">
              {icon && <span className="text-ink-3">{icon}</span>}
              {title}
            </h2>
          )}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={flush ? '' : 'p-4'}>{children}</div>
    </section>
  )
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: Array<{ id: T; label: string; disabled?: boolean }>
  value: T
  onChange: (id: T) => void
}) {
  return (
    <div className="mb-4 flex flex-wrap gap-1 border-b border-rule" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          disabled={tab.disabled}
          onClick={() => onChange(tab.id)}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
            tab.id === value ? 'border-seal text-seal' : 'border-transparent text-ink-2 hover:text-ink'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

// ── 대화 상자 ──────────────────────────────────────────────

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
    refreshToastHost()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className={`m-auto w-[calc(100%-2rem)] rounded-xl bg-sheet p-0 text-ink shadow-xl ${wide ? 'max-w-3xl' : 'max-w-md'}`}
    >
      {open && (
        <>
          <div className="flex items-center justify-between border-b border-rule px-4 py-3">
            <h2 className="text-base">{title}</h2>
            <button type="button" onClick={onClose} aria-label="닫기" className="text-ink-3 hover:text-ink">
              <X size={18} />
            </button>
          </div>
          <div className="max-h-[70vh] overflow-y-auto p-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-rule px-4 py-3">{footer}</div>}
        </>
      )}
    </dialog>
  )
}

/** 사유를 받아야 진행되는 확인 창 (거부, 반려, 킬 스위치 등) */
export function ReasonModal({
  open,
  title,
  description,
  label = '사유',
  placeholder,
  confirmLabel,
  danger = true,
  loading,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  description?: ReactNode
  label?: string
  placeholder?: string
  confirmLabel: string
  danger?: boolean
  loading?: boolean
  onConfirm: (reason: string) => void
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  useEffect(() => {
    if (open) setReason('')
  }, [open])
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>닫기</Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            disabled={!reason.trim()}
            disabledReason={`${label}를 입력해 주세요`}
            loading={loading}
            onClick={() => onConfirm(reason.trim())}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description && <div className="mb-3 text-sm text-ink-2">{description}</div>}
      <Field label={label}>
        {(id) => (
          <TextArea id={id} rows={3} value={reason} placeholder={placeholder} onChange={(e) => setReason(e.target.value)} autoFocus />
        )}
      </Field>
    </Modal>
  )
}

export function ConfirmModal({
  open,
  title,
  children,
  confirmLabel,
  danger,
  loading,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  danger?: boolean
  loading?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>닫기</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-ink-2">{children}</div>
    </Modal>
  )
}

/** 오른쪽에서 열리는 상세 패널 */
export function Drawer({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean
  title: ReactNode
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
    refreshToastHost()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="ml-auto h-dvh max-h-none w-full max-w-lg bg-sheet p-0 text-ink shadow-xl"
    >
      {open && (
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-rule px-4 py-3">
            <h2 className="text-base">{title}</h2>
            <button type="button" onClick={onClose} aria-label="닫기" className="text-ink-3 hover:text-ink">
              <X size={18} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">{children}</div>
        </div>
      )}
    </dialog>
  )
}

export function Mono({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <code className={`font-mono text-[0.8125rem] break-all ${className}`}>{children}</code>
}

export function CodeBlock({ children, label }: { children: string; label?: string }) {
  return (
    <div className="overflow-hidden rounded-md border border-rule">
      {label && <div className="border-b border-rule bg-sheet-alt px-3 py-1.5 text-xs text-ink-3">{label}</div>}
      <pre className="overflow-x-auto bg-sheet-alt p-3 font-mono text-[0.8125rem] leading-relaxed whitespace-pre-wrap text-ink">
        {children}
      </pre>
    </div>
  )
}
