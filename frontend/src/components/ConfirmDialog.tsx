import { type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

interface ConfirmDialogProps {
  title: string
  /** The consequence, in plain words. Shown under the title. */
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Tints the confirm button red, for anything destructive. */
  danger?: boolean
  /** Disables both buttons and swaps the confirm label while work is running. */
  busy?: boolean
  busyLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * The app's confirmation dialog.
 *
 * Extracted from the pattern WorkoutDetail and Equipment already use, so that
 * asking "are you sure" does not mean either hand-rolling a modal again or
 * falling back to window.confirm — which in the Android app renders as a stock
 * system alert, complete with the WebView's origin in the title.
 */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  busy = false,
  busyLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <>
      {/* Dismissible by tapping away, except while the action is running. */}
      <div className="overlay" onClick={() => { if (!busy) onCancel() }} />
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-box" style={{ maxWidth: 420 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <AlertTriangle size={20} style={{ color: danger ? 'var(--danger)' : 'var(--warning)' }} />
            <h3 style={{ fontSize: 16, fontWeight: 700 }}>{title}</h3>
          </div>
          <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 20, lineHeight: 1.5 }}>
            {message}
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
            <button
              className="btn btn-primary"
              style={danger ? { background: 'var(--danger)', borderColor: 'var(--danger)' } : undefined}
              onClick={onConfirm}
              disabled={busy}
            >
              {busy ? (busyLabel ?? `${confirmLabel}…`) : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
