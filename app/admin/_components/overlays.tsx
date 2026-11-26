'use client'

import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Button } from './button'

function subscribeToMount() {
  return () => {}
}

type ModalProps = {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  className?: string
}

export function Modal({ open, onClose, title, description, children, footer, className = '' }: ModalProps) {
  const portalReady = useSyncExternalStore(subscribeToMount, () => true, () => false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open || !portalReady) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const firstFocusable = dialog?.querySelector<HTMLElement>(focusableSelector)
    ;(firstFocusable ?? dialog)?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
        .filter((element) => element.offsetParent !== null)
      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocus?.focus()
    }
  }, [open, portalReady])

  if (!open || !portalReady) return null

  return createPortal(
    <div
      className="admin-ui-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        className={`admin-ui-modal${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <header className="admin-ui-modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <button type="button" className="admin-ui-modal-close" aria-label="Fermer la fenêtre" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        {children && <div className="admin-ui-modal-body">{children}</div>}
        {footer && <footer className="admin-ui-modal-footer">{footer}</footer>}
      </div>
    </div>,
    document.querySelector('.admin-app') ?? document.body,
  )
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = 'Confirmer cette action',
  description,
  children,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  confirmVariant = 'danger',
  loading = false,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title?: string
  description: ReactNode
  children?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  confirmVariant?: 'primary' | 'danger'
  loading?: boolean
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      className="admin-ui-confirm-dialog"
      footer={(
        <>
          <Button variant="outline" onClick={onClose} disabled={loading}>{cancelLabel}</Button>
          <Button variant={confirmVariant} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
        </>
      )}
    >
      {children}
    </Modal>
  )
}

export type ToastVariant = 'success' | 'info' | 'warning' | 'danger'
export type ToastOptions = {
  title: string
  description?: string
  variant?: ToastVariant
  durationMs?: number
}

type ToastItem = ToastOptions & { id: string }
type ToastContextValue = { toast: (options: ToastOptions) => string; dismissToast: (id: string) => void }

const ToastContext = createContext<ToastContextValue | null>(null)

const toastIcons = {
  success: CheckCircle2,
  info: Info,
  warning: TriangleAlert,
  danger: AlertCircle,
}

export function Toast({
  title,
  description,
  variant = 'info',
  onDismiss,
}: ToastOptions & { onDismiss: () => void }) {
  const Icon = toastIcons[variant]
  return (
    <div className={`admin-ui-toast is-${variant}`} role={variant === 'danger' ? 'alert' : 'status'}>
      <Icon size={19} aria-hidden="true" />
      <div className="admin-ui-toast-copy">
        <strong>{title}</strong>
        {description && <p>{description}</p>}
      </div>
      <button type="button" aria-label="Fermer la notification" onClick={onDismiss}>
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(0)
  const timers = useRef(new Map<string, number>())

  const dismissToast = useCallback((id: string) => {
    const timer = timers.current.get(id)
    if (timer !== undefined) window.clearTimeout(timer)
    timers.current.delete(id)
    setToasts((current) => current.filter((toastItem) => toastItem.id !== id))
  }, [])

  const toast = useCallback((options: ToastOptions) => {
    const id = `admin-toast-${++nextId.current}`
    setToasts((current) => [...current, { ...options, id }])
    const durationMs = options.durationMs ?? 5000
    if (durationMs > 0) {
      timers.current.set(id, window.setTimeout(() => dismissToast(id), durationMs))
    }
    return id
  }, [dismissToast])

  useEffect(() => () => {
    for (const timer of timers.current.values()) window.clearTimeout(timer)
    timers.current.clear()
  }, [])

  const contextValue = useMemo(() => ({ toast, dismissToast }), [dismissToast, toast])
  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <div className="admin-ui-toast-region" aria-label="Notifications" aria-live="polite">
        {toasts.map((toastItem) => (
          <Toast
            key={toastItem.id}
            {...toastItem}
            onDismiss={() => dismissToast(toastItem.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast doit être utilisé dans ToastProvider.')
  return context
}
