import { useState } from 'react'
import { ArrowUpCircle, X } from 'lucide-react'
import { applyPendingUpdate, useUpdatePending } from '../lib/appUpdate'

/**
 * Offers a newly installed build rather than applying it.
 *
 * The old behaviour reloaded the page as soon as a new worker activated, a few
 * seconds after launch — which is both startling and capable of discarding an
 * unsaved note or a half-filled import form. Waiting for a tap costs one
 * interaction and removes both problems.
 *
 * Dismissing only hides the toast. The worker stays waiting, the user menu
 * keeps offering "Update app", and it takes over anyway the next time the app
 * is fully closed and reopened — so nobody is stranded on an old version.
 */
export default function UpdateToast() {
  const ready = useUpdatePending()
  const [dismissed, setDismissed] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!ready || dismissed) return null

  return (
    <div className="update-toast" role="status">
      <ArrowUpCircle size={17} style={{ color: 'var(--primary)', flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="update-toast-title">Update available</span>
        <span className="update-toast-body">Reload to get the latest version.</span>
      </span>
      <button
        className="btn btn-primary"
        style={{ fontSize: 12, padding: '5px 12px', flexShrink: 0 }}
        disabled={busy}
        onClick={() => { setBusy(true); void applyPendingUpdate() }}
      >
        {busy ? 'Reloading…' : 'Reload'}
      </button>
      <button className="btn-icon" aria-label="Dismiss" onClick={() => setDismissed(true)}>
        <X size={15} />
      </button>
    </div>
  )
}
