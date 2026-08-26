/**
 * The app's dates, in one place.
 *
 * There were two copies of "time ago" — one for comments, one for when a plan
 * was last run — and they had already drifted: the plans one fell through to a
 * bare `toLocaleDateString()`, the only call in the app producing `8/17/2026`.
 * The plans list therefore showed `4 days ago` directly above `8/17/2026`, two
 * formats in adjacent rows of one list.
 *
 * The two relative resolutions are genuinely different and both are kept — a
 * comment from forty minutes ago is news, a plan run forty minutes ago is
 * today's session — but they now share the date they fall back to.
 *
 * The absolute formats are here for a second reason. Eight call sites passed
 * `'en-US'` explicitly while eight others passed `undefined` and followed the
 * reader's locale, so the same screen could show `Aug 23, 2026` above
 * `23 Aug 2026`. Nothing here names a locale: the browser knows one and it is
 * not this file's to override.
 */

/**
 * The app's absolute short date: locale-ordered, month by name so it can never
 * be read the wrong way round, and the year only when it is not this one.
 */
export function shortDate(d: Date): string {
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/**
 * A date key (`2026-08-23`) as a local Date at midnight.
 *
 * `new Date('2026-08-23')` parses as UTC and lands on the previous evening
 * anywhere west of Greenwich, which is how a workout ends up dated a day early.
 * The `T00:00:00` suffix is what makes it local, and it was being retyped at
 * every call site.
 */
export function fromDateKey(key: string): Date {
  return new Date(`${key}T00:00:00`)
}

/** "23 Aug" — no year, for axis ticks and anywhere the year is context. */
export function dayMonth(d: Date): string {
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** "Sunday, 23 August" — the workout's own headline date. */
export function longDate(d: Date): string {
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/**
 * Minute resolution, for something someone may be waiting on — a comment, a
 * ping. Falls out to a date after a week.
 */
export function whenLabel(iso: string): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''
  const mins = Math.round((Date.now() - then.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`
  if (mins < 60 * 24 * 7) return `${Math.round(mins / (60 * 24))}d ago`
  return shortDate(then)
}

/**
 * Day resolution, for something you did rather than something said to you:
 * "today", "yesterday", then days, then a date.
 */
export function relativeDay(iso: string): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''
  const days = Math.floor((Date.now() - then.getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return shortDate(then)
}

/**
 * How recent counts as "now".
 *
 * Coupled to `seenInterval` in the backend's sessiontrack.go, which is how
 * often a session's last-seen is actually written: this window has to stay
 * comfortably above it, or someone sitting in the app reads as minutes idle
 * because the server has not touched their row yet. That interval is a minute;
 * this is two, which leaves a minute of slack for a request that lands just
 * after a throttled one.
 *
 * Shortening it below the interval would not make the answer finer — it would
 * report the throttle instead of the person.
 */
const ACTIVE_WINDOW_MS = 2 * 60_000

/**
 * "Active now", "Last active 3 hours ago", "Last active 4 Mar" — when someone
 * was last around.
 *
 * Its own resolution rather than one of the two above, because the question is
 * different again: a person is either here, here today, or not, and the units
 * step up accordingly.
 *
 * Says nothing at all for an absent or unparseable time. "Last seen: never"
 * is a claim about someone, and the honest reading of no row is that we do not
 * know — see sessions.Store.LastSeenFor.
 */
function activityTime(iso: string | undefined, past: string): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  if (Date.now() - then < ACTIVE_WINDOW_MS) return 'Active now'
  const mins = Math.floor((Date.now() - then) / 60000)
  if (mins < 60) return `${past} ${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${past} ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${past} ${days} ${days === 1 ? 'day' : 'days'} ago`
  return `${past} ${shortDate(new Date(then))}`
}

export function lastActive(iso: string | undefined): string {
  return activityTime(iso, 'Last active')
}

/** Session-specific activity, which may differ from the user's latest device. */
export function lastUsed(iso: string | undefined): string {
  return activityTime(iso, 'Last used')
}

/** Whether someone counts as here right now — the one fact worth colouring. */
export function isActiveNow(iso: string | undefined): boolean {
  return !!iso && Date.now() - new Date(iso).getTime() < ACTIVE_WINDOW_MS
}
