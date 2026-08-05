import { useEffect, useRef, useState } from 'react'
import { X, Bell } from 'lucide-react'
import { apiURL } from '../lib/api'

/** How long a banner stays before dismissing itself. */
const AUTO_DISMISS_MS = 7000
/** Horizontal travel, in px, past which releasing a swipe dismisses. */
const SWIPE_PX = 70

export interface BannerNotification {
  id?: string
  title?: string
  body?: string
  link?: string
  icon?: string
}

interface NotificationBannerProps {
  notification: BannerNotification
  onOpen: (link: string) => void
  onDismiss: () => void
}

/**
 * In-app banner for a push that arrived while the app was on screen.
 *
 * The service worker suppresses the OS notification in that case (see sw.ts),
 * so this is the only thing the user sees — which is why it is dismissable
 * three ways: the close button, a swipe, and a timeout.
 */
export default function NotificationBanner({ notification, onOpen, onDismiss }: NotificationBannerProps) {
  const [dragX, setDragX] = useState(0)
  const startX = useRef<number | null>(null)
  const dragRef = useRef(0)

  useEffect(() => {
    const id = setTimeout(onDismiss, AUTO_DISMISS_MS)
    return () => clearTimeout(id)
  }, [onDismiss])

  function onTouchStart(e: React.TouchEvent) {
    startX.current = e.touches[0].clientX
  }

  function onTouchMove(e: React.TouchEvent) {
    if (startX.current === null) return
    dragRef.current = e.touches[0].clientX - startX.current
    setDragX(dragRef.current)
  }

  function onTouchEnd() {
    if (startX.current === null) return
    startX.current = null
    if (Math.abs(dragRef.current) > SWIPE_PX) onDismiss()
    else setDragX(0)
  }

  return (
    <div
      className="notif-banner"
      role="status"
      onClick={() => { if (notification.link) onOpen(notification.link) }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      style={{
        transform: dragX ? `translateX(${dragX}px)` : undefined,
        // Fade as it is pushed aside, so the gesture reads as "throwing away".
        opacity: dragX ? Math.max(0, 1 - Math.abs(dragX) / (SWIPE_PX * 2.5)) : undefined,
        transition: dragX ? 'none' : undefined,
      }}
    >
      {notification.icon
        /* Through apiURL: the icon is a path on the server, which in the app is
           not where the page came from. */
        ? <img className="notif-banner-icon" src={apiURL(notification.icon)} alt="" />
        : <span className="notif-banner-glyph"><Bell size={15} /></span>}

      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="notif-banner-title notif-clamp-2">{notification.title}</span>
        {notification.body && <span className="notif-banner-body notif-clamp-2">{notification.body}</span>}
      </span>

      <button
        className="btn-icon"
        aria-label="Dismiss"
        onClick={e => { e.stopPropagation(); onDismiss() }}
      >
        <X size={15} />
      </button>
    </div>
  )
}
