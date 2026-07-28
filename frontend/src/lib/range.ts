// Shared time-range vocabulary for every page that scopes its charts to a
// recent window (Dashboard, Analysis, Heatmap, Timeline). Ranges are expressed
// as a day count, with 0 meaning "all time".

export const RANGE_OPTIONS: { value: number; label: string; short: string }[] = [
  { value: 7, label: 'Last 7 days', short: '7d' },
  { value: 30, label: 'Last 30 days', short: '30d' },
  { value: 90, label: 'Last 90 days', short: '90d' },
  { value: 180, label: 'Last 6 months', short: '6mo' },
  { value: 365, label: 'Last year', short: '1y' },
  { value: 0, label: 'All time', short: 'All' },
]

/** Human-readable caption for a range, e.g. "last 30 days" or "all time". */
export function rangeLabel(days: number): string {
  return (RANGE_OPTIONS.find(o => o.value === days)?.label ?? `Last ${days} days`).toLowerCase()
}

/**
 * Earliest date (inclusive, YYYY-MM-DD) included by a range, or null for all
 * time. Dates are compared as strings throughout the app, which sidesteps
 * timezone drift from parsing a bare YYYY-MM-DD into a Date.
 */
export function rangeStartDate(days: number, now = new Date()): string | null {
  if (days <= 0) return null
  const d = new Date(now)
  d.setDate(d.getDate() - (days - 1))
  return toDateKey(d)
}

/** Local-time YYYY-MM-DD key for a Date (never UTC-shifted like toISOString). */
export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Filters any date-bearing records down to the given range. */
export function filterByRange<T extends { date: string }>(items: T[], days: number, now = new Date()): T[] {
  const start = rangeStartDate(days, now)
  return start == null ? items : items.filter(i => i.date >= start)
}
