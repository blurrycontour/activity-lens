import { Palette } from 'lucide-react'
import Modal from './Modal'

/**
 * The "you can change how this looks" nudge, for someone still on the default
 * accent.
 *
 * Shown until dismissed rather than once like ImportIntro: whether an accent
 * counts as "never touched" can only be answered by reading the current value,
 * so every app open re-asks the question — right up until Try or Close records
 * an answer, after which it stops for good on this device.
 */
const DISMISSED_KEY_PREFIX = 'al_accent_tip_dismissed_'

function dismissedKey(userId: number | string): string {
  return `${DISMISSED_KEY_PREFIX}${userId}`
}

export function hasDismissedAccentTip(userId: number | string): boolean {
  try {
    return localStorage.getItem(dismissedKey(userId)) !== null
  } catch {
    // Storage disabled or full. Treated as "already dismissed": a nag that
    // cannot be silenced is worse than one nobody sees.
    return true
  }
}

export function markAccentTipDismissed(userId: number | string): void {
  try {
    localStorage.setItem(dismissedKey(userId), new Date().toISOString())
  } catch {
    // Nothing to do; see above.
  }
}

interface AccentTipProps {
  onTry: () => void
  onClose: () => void
}

export default function AccentTip({ onTry, onClose }: AccentTipProps) {
  return (
    <Modal onClose={onClose} label="Make it yours">
      <div className="modal-box" style={{ maxWidth: 380 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <Palette size={20} style={{ color: 'var(--primary)' }} />
          <h3 style={{ fontSize: 16, fontWeight: 700 }}>Make it yours</h3>
        </div>
        <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 20, lineHeight: 1.5 }}>
          You can change the way the app looks — pick a highlight colour from six
          accents in Settings → Appearance.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={onTry}>Show me</button>
        </div>
      </div>
    </Modal>
  )
}
