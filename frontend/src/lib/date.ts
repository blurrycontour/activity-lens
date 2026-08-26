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
