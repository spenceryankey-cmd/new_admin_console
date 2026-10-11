import { AlertTriangle, Inbox, Loader2, WifiOff } from 'lucide-react'
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  busy?: boolean
}

export function Button({ variant = 'primary', busy, className = '', children, disabled, ...rest }: ButtonProps) {
  const styles = {
    primary: 'bg-forest-600 text-ink-950 hover:bg-forest-500 font-semibold',
    secondary: 'border border-ink-600 text-ink-100 hover:bg-ink-800',
    danger: 'bg-danger-600 text-white hover:bg-danger-700 font-semibold',
    ghost: 'text-ink-200 hover:bg-ink-800',
  }[variant]
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={`inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    >
      {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-ink-300">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {label}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="card flex flex-col items-center gap-3 px-6 py-12 text-center">
      <AlertTriangle className="h-6 w-6 text-clay-400" aria-hidden />
      <p className="max-w-md text-sm text-ink-100">{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center">
      <Inbox className="h-6 w-6 text-ink-400" aria-hidden />
      <p className="text-sm font-semibold text-ink-100">{title}</p>
      {hint && <p className="max-w-md text-sm text-ink-300">{hint}</p>}
    </div>
  )
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'green' | 'amber' | 'red' }) {
  const tones = {
    neutral: 'bg-ink-800 text-ink-200',
    green: 'bg-forest-900/70 text-forest-300',
    amber: 'bg-clay-600/30 text-clay-200',
    red: 'bg-danger-700/30 text-danger-200',
  }[tone]
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tones}`}>{children}</span>
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-ink-50 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-ink-300">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

/** Shown while the browser has no connection. Cached screens stay readable. */
export function OfflineBanner() {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  if (online) return null
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-clay-600 px-4 py-2 text-sm font-medium text-ink-950">
      <WifiOff className="h-4 w-4" aria-hidden />
      You are offline. What you see may be out of date, and changes will not save until you reconnect.
    </div>
  )
}

/**
 * Confirmation dialog for any action that changes a record. Collects the reason
 * where one is required, and keeps the dialog open with the error if it fails.
 */
export function ActionDialog({
  title,
  description,
  confirmLabel,
  danger,
  children,
  reasonLabel = 'Reason',
  requireReason = true,
  onConfirm,
  onClose,
}: {
  title: string
  description?: string
  confirmLabel: string
  danger?: boolean
  children?: ReactNode
  reasonLabel?: string
  requireReason?: boolean
  onConfirm: (reason: string) => Promise<void>
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const ready = !requireReason || reason.trim().length >= 3

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await onConfirm(reason.trim())
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="card max-h-[92vh] w-full max-w-md overflow-y-auto rounded-b-none p-5 sm:rounded-b-xl">
        <h2 className="text-lg font-semibold text-ink-50">{title}</h2>
        {description && <p className="mt-1 text-sm text-ink-300">{description}</p>}
        {children && <div className="mt-4 space-y-4">{children}</div>}
        {requireReason && (
          <div className="mt-4">
            <label className="label" htmlFor="reason">
              {reasonLabel}
            </label>
            <textarea id="reason" rows={3} className="field" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Say why, in a few words" />
          </div>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger-400">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={submit} busy={busy} disabled={!ready}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
