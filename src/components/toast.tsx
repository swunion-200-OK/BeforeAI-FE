import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

type ToastKind = 'success' | 'error' | 'info'
interface ToastItem {
  id: number
  kind: ToastKind
  message: string
}

let items: ToastItem[] = []
let nextId = 1
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((listener) => listener())
}

function dismiss(id: number) {
  items = items.filter((item) => item.id !== id)
  emit()
}

function push(kind: ToastKind, message: string) {
  // 같은 오류가 여러 쿼리에서 동시에 나도 한 번만 보여 준다.
  if (items.some((item) => item.message === message)) return
  const id = nextId++
  items = [...items, { id, kind, message }]
  emit()
  setTimeout(() => dismiss(id), kind === 'error' ? 6000 : 4000)
}

/** React 바깥(쿼리 캐시 등)에서도 부를 수 있다. */
export const toast = {
  success: (message: string) => push('success', message),
  error: (message: string) => push('error', message),
  info: (message: string) => push('info', message),
}

const STYLE: Record<ToastKind, { className: string; Icon: typeof Info }> = {
  success: { className: 'text-low', Icon: CircleCheck },
  error: { className: 'text-high', Icon: CircleAlert },
  info: { className: 'text-seal', Icon: Info },
}

const hostListeners = new Set<() => void>()
let host: HTMLElement | null = null

/** 모달 밖의 요소는 비활성(inert)이 되므로, 모달이 열려 있으면 그 안에 토스트를 그린다. */
export function refreshToastHost() {
  const dialogs = document.querySelectorAll<HTMLElement>('dialog[open]')
  const next = dialogs.length ? dialogs[dialogs.length - 1] : null
  if (next === host) return
  host = next
  hostListeners.forEach((listener) => listener())
}

export function Toaster() {
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => items,
  )
  const target = useSyncExternalStore(
    (listener) => {
      hostListeners.add(listener)
      return () => hostListeners.delete(listener)
    },
    () => host,
  )
  return createPortal(
    <div
      className="pointer-events-none fixed top-4 left-1/2 z-[60] flex w-full max-w-lg -translate-x-1/2 flex-col gap-2 px-4"
      role="status"
      aria-live="polite"
    >
      {current.map((item) => {
        const { className, Icon } = STYLE[item.kind]
        return (
          <div
            key={item.id}
            className={`animate-toast pointer-events-auto flex items-start gap-2.5 rounded-xl border border-rule bg-sheet px-4 py-3 text-base font-medium shadow-raised ${className}`}
          >
            <Icon size={20} className="mt-0.5 shrink-0" aria-hidden />
            <span className="flex-1 text-ink">{item.message}</span>
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              className="text-ink-3 hover:text-ink"
              aria-label="알림 닫기"
            >
              <X size={16} />
            </button>
          </div>
        )
      })}
    </div>,
    target ?? document.body,
  )
}
