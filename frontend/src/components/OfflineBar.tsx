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
interface OfflineBarProps {
  /**
   * Renders pinned to the top of the viewport instead of occupying the app
   * layout's second grid row. Needed on the login screen, which has no app
   * layout to sit inside — and which is precisely where an offline user ends
   * up if their session cannot be checked.
   */
  floating?: boolean
}

export default function OfflineBar({ floating = false }: OfflineBarProps) {
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
      className={`offline-bar${floating ? ' floating' : ''}`}
      // Kept mounted and collapsed so both directions animate; the height
      // transition is what makes it push the content down rather than overlap.
      data-visible={visible ? 'true' : 'false'}
      /*
       * Zero height is not hidden. Collapsed, this element stayed in the
       * accessibility tree on every page of the app, so "Offline — showing
       * saved data" was in every aria snapshot and a screen reader announced
       * it on arrival at each screen, online or not. aria-hidden takes it out;
       * the CSS pairs it with visibility so the two agree.
       */
      aria-hidden={visible ? undefined : true}
      style={{
        // Neutral greys pulled from the theme variables, so this follows the
        // light/dark switch instead of being a fixed colour. Only the brief
        // reconnect confirmation uses the accent.
        background: reconnected ? 'var(--primary-dim)' : 'var(--bg-3)',
        color: reconnected ? 'var(--primary)' : 'var(--text-2)',
        borderBottom: `1px solid ${reconnected ? 'var(--primary)' : 'var(--border-strong)'}`,
      }}
    >
      {reconnected ? <Check size={13} /> : <CloudOff size={13} />}
      <span>{reconnected ? 'Back online' : 'Offline — showing saved data'}</span>
    </div>
  )
}
