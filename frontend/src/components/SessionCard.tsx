import { Globe, Smartphone, Monitor, HelpCircle } from 'lucide-react'
import type { SessionInfo } from '../lib/api'

/**
 * One signed-in device.
 *
 * Shared by Settings > Security and the admin's view of another account,
 * because the question is the same in both places — is this device still
 * meant to be here — and only the button differs.
 *
 * What it shows is deliberately layered by how much it can be trusted. The
 * client's own declaration comes first, because it is the only thing that
 * knows whether this is the app or a browser and which build it runs. The
 * user agent is behind that, parsed for a name and a platform. The raw agent
 * shows only when nothing else survived, since an unreadable string beats a
 * confident wrong label on a screen whose job is deciding what to revoke.
 */

/** Absolute date and time, for a login that happened at a moment. */
function formatDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * How long ago, in the units a person would say it in.
 *
 * Relative rather than absolute for last-seen: "3 days ago" answers "is this
 * still in use" at a glance, where a date makes you do the subtraction.
 */
export function ago(iso: string): string {
  const then = new Date(iso).getTime()
  if (isNaN(then)) return ''
  const mins = Math.floor((Date.now() - then) / 60000)
  if (mins < 6) return 'active now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return formatDate(iso)
}

/** The mark for a device: the app, a phone browser, or a desktop one. */
function DeviceIcon({ session: s }: { session: SessionInfo }) {
  if (s.kind === 'android') return <Smartphone size={16} />
  if (s.kind === 'web') return s.mobile ? <Smartphone size={16} /> : <Monitor size={16} />
  // Nothing declared: fall back to what the agent suggested, and say so with a
  // question mark rather than picking one.
  if (s.platform) return s.mobile ? <Smartphone size={16} /> : <Globe size={16} />
  return <HelpCircle size={16} />
}

/**
 * The headline for a device, best-known first.
 *
 * "Android app" beats "Chrome 141 on Android" because the app *is* a Chrome
 * WebView — the agent is technically right and tells you the wrong thing.
 */
function title(s: SessionInfo): string {
  if (s.kind === 'android') return 'Android app'
  const where = s.platform ? ` on ${s.platform}` : ''
  if (s.browser) return s.browser + where
  if (s.platform) return `Browser on ${s.platform}`
  return s.userAgent || 'Unknown device'
}

export default function SessionCard({
  session: s, action,
}: {
  session: SessionInfo
  /** Whatever revokes this session, or the "this device" marker. */
  action?: React.ReactNode
}) {
  const showRawAgent = !s.browser && !s.platform && !s.kind && !!s.userAgent
  return (
    <div className="tile session-card">
      <span className="session-card-icon"><DeviceIcon session={s} /></span>
      <div className="session-card-body">
        <div className="session-card-title">
          {title(s)}
          {s.appVersion && <span className="session-card-tag">v{s.appVersion}</span>}
          {s.kind === 'web' && <span className="session-card-tag">Browser</span>}
        </div>
        <div className="session-card-meta">
          {/* Each fact on its own chip rather than one run-on line: on a phone
              this wraps to two or three rows and stays readable, where a
              middot-joined sentence would break in the middle of an address. */}
          {s.ip && <span>{s.ip}</span>}
          {s.lastSeen && <span>{ago(s.lastSeen)}</span>}
          <span>signed in {formatDate(s.createdAt)}</span>
        </div>
        {/* Only when nothing above came from it — otherwise it is a second,
            longer copy of what the title already said. */}
        {showRawAgent && <div className="session-card-agent">{s.userAgent}</div>}
      </div>
      {action}
    </div>
  )
}
