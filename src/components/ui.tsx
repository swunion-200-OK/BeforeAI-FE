import { Loader2, X } from 'lucide-react'
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
import { MISSING_ON_SERVER_MESSAGE, isMissingOnServer } from '../api/missingOnServer'
import { INTERNAL_ONLY_MESSAGE } from '../api/errors'
import { josa } from '../lib/josa'
import { useIsExternal } from '../lib/queries'
import { refreshToastHost } from './toast'

// ── 버튼 ───────────────────────────────────────────────────

const BUTTON_VARIANT = {
  primary: 'bg-seal text-white hover:bg-seal-dark active:bg-seal-dark disabled:bg-rule disabled:text-ink-3',
  secondary: 'border border-rule-strong bg-sheet text-ink hover:bg-sheet-alt disabled:text-ink-3 disabled:bg-sheet-alt',
  danger: 'bg-high text-white hover:bg-[#a40e26] disabled:bg-rule disabled:text-ink-3',
  'danger-outline': 'border border-high bg-sheet text-high hover:bg-high-soft disabled:border-rule-strong disabled:text-ink-3',
  ghost: 'text-ink-2 hover:bg-sheet-alt hover:text-ink disabled:text-ink-3',
} as const

const BUTTON_SIZE = {
  sm: 'h-9 px-3 text-[0.875rem] gap-1.5',
  md: 'h-10 px-4 text-sm gap-1.5',
  lg: 'h-12 px-6 text-base gap-2',
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
  // 스크롤 영역에 잘리지 않도록 화면 기준으로 띄운다. 위에 자리가 없으면 아래로 연다.
  const [position, setPosition] = useState<{ left: number; top: number; below: boolean } | null>(null)
  const show = (target: HTMLElement) => {
    const box = target.getBoundingClientRect()
    const below = box.top < 48
    setPosition({
      left: Math.min(Math.max(box.left + box.width / 2, 136), window.innerWidth - 136),
      top: below ? box.bottom + 6 : box.top - 6,
      below,
    })
  }
  return (
    <span
      className="relative inline-flex"
      tabIndex={0}
      role="group"
      aria-label={text}
      onMouseEnter={(event) => show(event.currentTarget)}
      onMouseLeave={() => setPosition(null)}
      onFocus={(event) => show(event.currentTarget)}
      onBlur={() => setPosition(null)}
    >
      {children}
      <span
        role="tooltip"
        style={
          position
            ? {
                left: position.left,
                top: position.top,
                transform: position.below ? 'translateX(-50%)' : 'translate(-50%, -100%)',
              }
            : undefined
        }
        className={`pointer-events-none fixed z-50 w-max max-w-64 rounded-md bg-ink px-2.5 py-1.5 text-xs font-normal text-white ${
          position ? 'block' : 'hidden'
        }`}
      >
        {text}
      </span>
    </span>
  )
}

// ── 입력 ───────────────────────────────────────────────────

const INPUT_CLASS =
  'w-full rounded-md border border-rule-input bg-sheet px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-seal focus:outline-2 focus:-outline-offset-1 focus:outline-seal disabled:border-rule disabled:bg-sheet-alt disabled:text-ink-3'

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
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink-2">
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

/** 왼쪽 선 하나로 알린다. 면을 칠하지 않고, 곧은 선이라 문서의 난외 표시처럼 보인다. */
const BANNER_TONE = {
  info: { rule: 'border-seal', title: 'text-ink' },
  warning: { rule: 'border-medium', title: 'text-medium' },
  danger: { rule: 'border-high', title: 'text-high' },
  neutral: { rule: 'border-rule-strong', title: 'text-ink' },
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
  const { rule, title: titleColor } = BANNER_TONE[tone]
  return (
    <div className={`flex items-start gap-3 border-l-[3px] py-1 pl-3.5 text-sm text-ink ${rule}`} role={tone === 'danger' ? 'alert' : undefined}>
      <div className="min-w-0 flex-1">
        {title && <p className={`font-semibold ${titleColor}`}>{title}</p>}
        {children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

/** 글자로 안내할 일이 있으면 label을 준다. 없으면 내용 자리에 옅은 막대를 그려 화면이 덜 튄다. */
export function Spinner({ label }: { label?: string }) {
  if (!label) {
    return (
      <div className="flex animate-pulse flex-col gap-3 px-5 py-6" role="status">
        <span className="sr-only">불러오는 중</span>
        <div className="h-5 w-2/5 rounded-md bg-rule" />
        <div className="h-5 w-full rounded-md bg-rule/70" />
        <div className="h-5 w-4/5 rounded-md bg-rule/70" />
      </div>
    )
  }
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-ink-3" role="status">
      <Loader2 size={18} className="animate-spin" aria-hidden />
      {label}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  // 없는 API는 다시 불러와도 같으니 오류처럼 보이지 않게 하고 다시 시도 버튼도 두지 않는다.
  if (isMissingOnServer(error)) return <EmptyState title={MISSING_ON_SERVER_MESSAGE}>서버에 API가 추가되면 여기에 표시됩니다.</EmptyState>
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <p className="text-base text-high">{error instanceof Error ? error.message : '불러오지 못했습니다'}</p>
      {onRetry && <Button onClick={onRetry}>다시 불러오기</Button>}
    </div>
  )
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <p className="text-lg font-semibold text-ink">{title}</p>
      {children && <p className="max-w-md text-base text-ink-2">{children}</p>}
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
    <header className="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-[1.875rem] leading-tight font-semibold tracking-[-0.02em]">{title}</h1>
        {description && <p className="mt-1.5 max-w-[80ch] text-base text-ink-2">{description}</p>}
        {meta && <div className="mt-2.5 flex flex-wrap items-center gap-2 text-sm text-ink-2">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

/** 선으로 두른 서류 한 장. 안쪽 여백을 직접 정하고 싶으면 flush를 준다. */
export function Sheet({
  title,
  actions,
  children,
  flush,
  className = '',
}: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  flush?: boolean
  className?: string
}) {
  return (
    <section className={`rounded-xl border border-rule bg-sheet ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-3">
          {title && (
            <h2 className="text-base font-semibold">{title}</h2>
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
          className={`-mb-px border-b-2 px-3.5 py-2.5 text-sm ${
            tab.id === value ? 'border-seal font-semibold text-ink' : 'border-transparent font-medium text-ink-2 hover:text-ink'
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
    // 창이 열린 채 화면을 떠나면 토스트가 사라진 창 안에 남지 않게 다시 찾는다.
    return () => refreshToastHost()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className={`m-auto w-[calc(100%-2rem)] rounded-xl bg-sheet p-0 text-ink shadow-raised ${wide ? 'max-w-3xl' : 'max-w-[30rem]'}`}
    >
      {open && (
        <>
          <div className="flex items-center justify-between border-b border-rule px-5 py-4">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button type="button" onClick={onClose} aria-label="닫기" className="-mr-1 rounded-md p-1.5 text-ink-3 hover:bg-sheet-alt hover:text-ink">
              <X size={20} />
            </button>
          </div>
          <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-rule px-5 py-4">{footer}</div>}
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
            disabledReason={`${josa(label, '을', '를')} 입력해 주세요`}
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
    // 창이 열린 채 화면을 떠나면 토스트가 사라진 창 안에 남지 않게 다시 찾는다.
    return () => refreshToastHost()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="ml-auto h-dvh max-h-none w-full max-w-lg bg-sheet p-0 text-ink shadow-raised"
    >
      {open && (
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-rule px-5 py-4">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button type="button" onClick={onClose} aria-label="닫기" className="-mr-1 rounded-md p-1.5 text-ink-3 hover:bg-sheet-alt hover:text-ink">
              <X size={20} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-5">{children}</div>
        </div>
      )}
    </dialog>
  )
}

export function Mono({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <code className={`font-mono text-[0.875rem] break-all ${className}`}>{children}</code>
}

export function CodeBlock({ children, label }: { children: string; label?: string }) {
  return (
    <div className="overflow-hidden rounded-md border border-rule">
      {label && <div className="border-b border-rule bg-sheet-alt px-3 py-1.5 text-xs text-ink-3">{label}</div>}
      <pre className="overflow-x-auto bg-sheet-alt p-3 font-mono text-[0.875rem] leading-relaxed whitespace-pre-wrap text-ink">
        {children}
      </pre>
    </div>
  )
}
