import { useEffect, useRef, useState } from 'react'
import { CloudOff, Check } from 'lucide-react'
import { useOnlineStatus } from '../lib/network'

/** How long the "Back online" confirmation stays up before dismissing itself. */
const RECONNECT_FLASH_MS = 2200

/**
 * A slim bar that slides in under the top bar when the backend is unreachable,
 * and flashes a green confirmation on reconnect before hiding itself.
 *
 * Renders nothing at all while online, so it has no effect on the normal UI.
 */
export default function OfflineBar() {
  const online = useOnlineStatus()
  const [showReconnected, setShowReconnected] = useState(false)
  // Tracks whether we have actually been offline, so a normal page load does
  // not flash "Back online" at someone who was never disconnected.
  const wasOffline = useRef(false)

  useEffect(() => {
    if (!online) {
      wasOffline.current = true
      setShowReconnected(false)
      return
    }
    if (!wasOffline.current) return
    wasOffline.current = false
    setShowReconnected(true)
    const t = window.setTimeout(() => setShowReconnected(false), RECONNECT_FLASH_MS)
    return () => window.clearTimeout(t)
  }, [online])

  const visible = !online || showReconnected
  const reconnected = online && showReconnected

  return (
    <div
      role="status"
      aria-live="polite"
      className="offline-bar"
      // Kept mounted and collapsed so both directions animate; the height
      // transition is what makes it push the content down rather than overlap.
      data-visible={visible ? 'true' : 'false'}
      style={{
        background: reconnected ? 'var(--primary-dim)' : 'rgba(217, 119, 6, 0.15)',
        color: reconnected ? 'var(--primary)' : '#d97706',
        borderBottom: `1px solid ${reconnected ? 'var(--primary)' : 'rgba(217, 119, 6, 0.35)'}`,
      }}
    >
      {reconnected ? <Check size={13} /> : <CloudOff size={13} />}
      <span>{reconnected ? 'Back online' : 'Offline — showing saved data'}</span>
    </div>
  )
}
