/**
 * The app's relative timestamps, in one place.
 *
 * There were two copies of "time ago" — one for comments, one for when a plan
 * was last run — and they had already drifted: the plans one fell through to a
 * bare `toLocaleDateString()`, the only call in the app producing `8/17/2026`.
 * The plans list therefore showed `4 days ago` directly above `8/17/2026`, two
 * formats in adjacent rows of one list.
 *
 * The two resolutions are genuinely different and both are kept — a comment
 * from forty minutes ago is news, a plan run forty minutes ago is today's
 * session — but they now share the date they fall back to.
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
