import { Calendar, Circle, Network, Smartphone, HelpCircle } from 'lucide-react'
import type { SessionInfo } from '../lib/api'
import { isActiveNow, lastUsed } from '../lib/date'
import BrowserMark from './BrowserMark'

/**
 * One signed-in device.
 *
 * Shared by Settings > Security and the admin's view of another account,
 * because the question is the same in both places — is this device still
 * meant to be here — and only the button differs.
 *
 * What it shows is layered by how far it can be trusted. The client's own
 * declaration comes first, because it is the only thing that knows whether
 * this is the app or a browser and which build it runs. The user agent is
 * behind that, parsed for a name and a platform. The raw agent shows only when
 * nothing else survived, since an unreadable string beats a confident wrong
 * label on a screen whose next click revokes something.
 */

/** Absolute date and time, for a login that happened at a moment. */
function formatDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * The mark for a device.
 *
 * The app gets a phone; a browser gets its own logo, because a list of devices
 * is scanned rather than read and two rows saying "Chrome" and "Firefox" take
 * the same shape at a glance where their marks do not.
 */
function DeviceMark({ session: s }: { session: SessionInfo }) {
  if (s.kind === 'android') return <Smartphone size={18} />
  if (s.browser) return <BrowserMark browser={s.browser} size={18} />
  if (s.platform) return <BrowserMark size={18} />
  return <HelpCircle size={18} />
}

/**
 * The headline for a device.
 *
 * "Android app" beats "Chrome 141 on Android" because the app *is* a Chrome
 * WebView — the agent is technically right and tells you the wrong thing.
 */
function title(s: SessionInfo): string {
  if (s.kind === 'android') return 'Android app'
  if (s.browser) return s.browser
  if (s.platform) return `Browser on ${s.platform}`
  return s.userAgent || 'Unknown device'
}

/** One fact, with its own mark, on its own line. */
function Line({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="session-line">
      <span className="session-line-icon">{icon}</span>
      <span>{children}</span>
    </div>
  )
}

export default function SessionCard({
  session: s, action,
}: {
  session: SessionInfo
  /** Whatever revokes this session, or the "this device" marker. */
  action?: React.ReactNode
}) {
  const showRawAgent = !s.browser && !s.platform && !s.kind && !!s.userAgent
  // "Active now" is the one fact worth colouring: it is what separates a device
  // in use from one signed in months ago and forgotten.
  const live = isActiveNow(s.lastSeen)

  return (
    <div className="session-card">
      <span className="session-card-mark"><DeviceMark session={s} /></span>

      <div className="session-card-body">
        <div className="session-card-title">
          {title(s)}
          {/* The platform belongs with the name rather than on a line of its
              own: "Chrome" and "Windows" are one answer to "what is this". */}
          {s.platform && s.kind !== 'android' && <span className="session-card-on">on {s.platform}</span>}
          {s.appVersion && <span className="session-card-tag">v{s.appVersion}</span>}
        </div>

        {/* One fact per line. They used to share a row joined by middots,
            which on a phone wrapped through the middle of an IP address. */}
        <div className="session-card-facts">
          {s.lastSeen && (
            <Line icon={<Circle size={7} fill="currentColor" strokeWidth={0} />}>
              <span className={live ? 'session-live' : undefined}>{lastUsed(s.lastSeen)}</span>
            </Line>
          )}
          {s.ip && <Line icon={<Network size={12} />}>{s.ip}</Line>}
          <Line icon={<Calendar size={12} />}>Session started {formatDate(s.createdAt)}</Line>
        </div>

        {/* Only when nothing above came from it — otherwise it is a second,
            longer copy of what the title already said. */}
        {showRawAgent && <div className="session-card-agent">{s.userAgent}</div>}
      </div>

      {action && <div className="session-card-action">{action}</div>}
    </div>
  )
}
