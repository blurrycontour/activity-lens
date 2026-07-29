import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bell, Check, Share2, Footprints, Trophy, Clock, X, Trash2 } from 'lucide-react'
import { api, type AppNotification, type NotificationKind } from '../lib/api'
import { dismissOSNotification, enablePush, maybePromptForPush, pushState, syncPushSubscription, type PushState } from '../lib/push'
import { useIsMobile } from '../lib/useIsMobile'

/**
 * Dispatched by App when the service worker forwards a push that arrived while
 * the app was visible, so the bell updates instantly instead of on the poll.
 */
export const PUSH_EVENT = 'al:push'

/** How often to re-check the unread count while the app is open. */
const POLL_MS = 60_000
/** Badge stops counting past this, to keep the bell a fixed size. */
const MAX_BADGE = 9

const KIND_ICON: Record<NotificationKind, React.ReactNode> = {
  workout_shared: <Share2 size={14} />,
  gear_worn: <Footprints size={14} />,
  goal_met: <Trophy size={14} />,
  goal_at_risk: <Clock size={14} />,
}

/** Relative time, at the granularity a notification list actually needs. */
function ago(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

interface NotificationBellProps {
  /** Navigates to a notification's in-app link. */
  onNavigate: (link: string) => void
}

/**
 * Bell in the top bar, with a panel of recent notifications.
 *
 * A panel rather than a page: this is a handful of shares and nudges, not a
 * feed, and taking someone away from what they were doing to read one line
 * would be the wrong trade. It also keeps the mobile bottom bar at five items.
 */
export default function NotificationBell({ onNavigate }: NotificationBellProps) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<AppNotification[]>([])
  const [unread, setUnread] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [push, setPush] = useState<PushState>('unsupported')
  const [pushKey, setPushKey] = useState('')
  // Where to pin the panel, measured from the bell. Needed because the panel is
  // portalled out of the top bar (see the render), so it can no longer be
  // positioned relative to its trigger by CSS alone.
  const [anchor, setAnchor] = useState({ top: 0, right: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  // On a phone the panel spans the viewport via CSS insets instead of hanging
  // off the bell, so the measured anchor must not be applied — an inline style
  // would override the stylesheet's left/right and pull it off-centre.
  const isMobile = useIsMobile()

  const load = useCallback(async () => {
    try {
      const res = await api.notifications()
      setItems(res.notifications)
      setUnread(res.unread)
      setPushKey(res.pushKey ?? '')
      setPush(res.pushKey ? await pushState() : 'unsupported')
      setLoaded(true)
      return res.pushKey ?? ''
    } catch {
      // A failed poll is not worth surfacing; the next one may well succeed.
    }
    return ''
  }, [])

  // Ask for permission once, on first load, rather than making every user find
  // the switch in Settings. Deliberately fire-and-forget: see the notes on
  // maybePromptForPush for why this cannot be relied on alone.
  useEffect(() => {
    void (async () => {
      const key = await load()
      if (!key) return
      // Keep the server's record of this device in step with the browser's.
      await syncPushSubscription()
      setPush(await maybePromptForPush(key))
    })()
    // Runs once on mount; the polling effect below keeps it current after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Poll while the tab is visible. Push covers the app being closed, so this
  // only has to catch changes made in another session or on another device.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') void load() }
    const id = setInterval(tick, POLL_MS)
    document.addEventListener('visibilitychange', tick)
    // A push that landed while the app was open is the fastest signal there is,
    // so refresh on it rather than waiting out the poll.
    window.addEventListener(PUSH_EVENT, tick)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
      window.removeEventListener(PUSH_EVENT, tick)
    }
  }, [load])

  // The backdrop handles dismissal by click; this covers the keyboard.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setAnchor({ top: r.bottom + 8, right: window.innerWidth - r.right })
  }, [open])

  function toggle() {
    setOpen(o => {
      // Refresh on open so the list is current even between polls.
      if (!o) void load()
      return !o
    })
  }

  async function openItem(n: AppNotification) {
    setOpen(false)
    if (!n.readAt) {
      setItems(prev => prev.map(i => i.id === n.id ? { ...i, readAt: new Date().toISOString() } : i))
      setUnread(c => Math.max(0, c - 1))
      await api.markNotificationRead(n.id).catch(() => {})
    }
    // Reading it here should clear it from the OS tray too.
    void dismissOSNotification(n.id)
    if (n.link) onNavigate(n.link)
  }

  async function turnOnPush() {
    try {
      setPush(await enablePush(pushKey))
    } catch {
      setPush('denied')
    }
  }

  async function markAll() {
    const unreadIds = items.filter(i => !i.readAt).map(i => i.id)
    setItems(prev => prev.map(i => i.readAt ? i : { ...i, readAt: new Date().toISOString() }))
    setUnread(0)
    await api.markAllNotificationsRead().catch(() => {})
    for (const id of unreadIds) void dismissOSNotification(id)
  }

  async function clearAll() {
    setItems([])
    setUnread(0)
    await api.clearNotifications().catch(() => {})
  }

  async function dismiss(e: React.MouseEvent, n: AppNotification) {
    e.stopPropagation()
    setItems(prev => prev.filter(i => i.id !== n.id))
    if (!n.readAt) setUnread(c => Math.max(0, c - 1))
    await api.deleteNotification(n.id).catch(() => {})
  }

  return (
    <div className="notif-wrap">
      <button
        ref={btnRef}
        className="btn-icon"
        onClick={toggle}
        style={{ position: 'relative' }}
        title="Notifications"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
      >
        <Bell size={17} />
        {unread > 0 && (
          <span className="notif-badge">{unread > MAX_BADGE ? `${MAX_BADGE}+` : unread}</span>
        )}
      </button>

      {/* Portalled to <body> rather than rendered in place: the top bar sets
          z-index, which makes it a stacking context, so a panel nested inside it
          can never rise above a full-screen backdrop no matter its own z-index.
          The backdrop matters because without one, a tap outside the panel
          closes it *and* activates whatever was underneath — easy to do on a
          phone, where the panel is nearly full width. */}
      {open && createPortal(
        <>
        <div className="overlay" onClick={() => setOpen(false)} />
        <div
          className="notif-panel"
          role="dialog"
          aria-label="Notifications"
          style={isMobile ? undefined : { top: anchor.top, right: anchor.right }}
        >
          <div className="notif-head">
            <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>Notifications</span>
            {unread > 0 && (
              <button className="notif-action" onClick={() => void markAll()} title="Mark all as read">
                <Check size={13} /> Mark all read
              </button>
            )}
            {items.length > 0 && (
              <button className="notif-action" onClick={() => void clearAll()} title="Clear all">
                <Trash2 size={13} />
              </button>
            )}
          </div>

          {/* Push being off is the difference between hearing about a share
              now and hearing about it next time you open the app, so it is
              worth saying rather than leaving to Settings. */}
          {loaded && push === 'off' && pushKey && (
            <div className="notif-hint">
              <span style={{ flex: 1 }}>Notifications only appear here while the app is open.</span>
              <button onClick={() => void turnOnPush()}>Enable push</button>
            </div>
          )}
          {loaded && push === 'denied' && (
            <div className="notif-hint">
              <span>Your browser is blocking notifications for this site. Allow them in its site settings to get them while the app is closed.</span>
            </div>
          )}

          <div className="notif-list">
            {items.length === 0 ? (
              <p className="notif-empty">
                {loaded ? 'Nothing new. Shares and nudges will show up here.' : 'Loading…'}
              </p>
            ) : items.map(n => (
              <button
                key={n.id}
                className={`notif-item${n.readAt ? '' : ' unread'}`}
                onClick={() => void openItem(n)}
              >
                {n.icon
                  ? <img className="notif-avatar" src={n.icon} alt="" />
                  : <span className="notif-icon">{KIND_ICON[n.kind] ?? <Bell size={14} />}</span>}
                <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <span className="notif-title">{n.title}</span>
                  {n.body && <span className="notif-body">{n.body}</span>}
                  <span className="notif-time">{ago(n.createdAt)}</span>
                </span>
                <span
                  className="notif-dismiss"
                  role="button"
                  tabIndex={-1}
                  aria-label="Dismiss"
                  onClick={e => void dismiss(e, n)}
                >
                  <X size={12} />
                </span>
              </button>
            ))}
          </div>
        </div>
        </>,
        document.body,
      )}
    </div>
  )
}
