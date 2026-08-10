// Continuous time axes for the analysis charts.
//
// Every time series on the Analysis page is built by grouping the workouts that
// exist, which means the x axis is a list of the days you trained rather than a
// stretch of time. Three runs in one week and then a month off come out evenly
// spaced, so a break in training reads as a steady rhythm and a downward trend
// can be an artefact of where the gaps fell. These helpers fill the missing
// positions back in, behind a toggle — the compact version is genuinely easier
// to read when the gaps are not the point.

import { toDateKey } from './range'
import { parseDateKey } from './insights'

/** Every YYYY-MM-DD from `first` to `last` inclusive. */
export function everyDayBetween(first: string, last: string): string[] {
  const out: string[] = []
  const cursor = parseDateKey(first)
  const end = parseDateKey(last)
  // Guard rather than trust: a reversed pair would spin here forever.
  if (cursor > end) return [first]
  while (cursor <= end) {
    out.push(toDateKey(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}

/**
 * Every Monday key from `first` to `last` inclusive. Both are expected to be
 * Monday keys already — the callers group by one — so stepping seven days at a
 * time stays on Mondays.
 */
export function everyWeekBetween(first: string, last: string): string[] {
  const out: string[] = []
  const cursor = parseDateKey(first)
  const end = parseDateKey(last)
  if (cursor > end) return [first]
  while (cursor <= end) {
    out.push(toDateKey(cursor))
    cursor.setDate(cursor.getDate() + 7)
  }
  return out
}

/** Every YYYY-MM from `first` to `last` inclusive. */
export function everyMonthBetween(first: string, last: string): string[] {
  const out: string[] = []
  const [fy, fm] = first.split('-').map(Number)
  const [ly, lm] = last.split('-').map(Number)
  let index = fy * 12 + (fm - 1)
  const end = ly * 12 + (lm - 1)
  if (index > end) return [first]
  while (index <= end) {
    out.push(`${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`)
    index++
  }
  return out
}

/**
 * Rebuilds `rows` over `keys`, inserting `blank(key)` wherever there is no row.
 *
 * Rows are matched by `keyOf` and keep their original order within a key, so a
 * day with two activities still contributes both points. Only the span the data
 * actually covers is filled — padding out to the edges of the selected range
 * would add empty months nobody trained in and call it a gap.
 */
export function fillGaps<T>(
  rows: T[],
  keys: string[],
  keyOf: (row: T) => string,
  blank: (key: string) => T,
): T[] {
  if (rows.length === 0) return rows
  const byKey = new Map<string, T[]>()
  for (const row of rows) {
    const key = keyOf(row)
    const bucket = byKey.get(key)
    if (bucket) bucket.push(row)
    else byKey.set(key, [row])
  }
  const out: T[] = []
  for (const key of keys) {
    const bucket = byKey.get(key)
    if (bucket) out.push(...bucket)
    else out.push(blank(key))
  }
  return out
}

/** The first and last key present in `rows`, or null when there are none. */
export function keySpan<T>(rows: T[], keyOf: (row: T) => string): [string, string] | null {
  if (rows.length === 0) return null
  let first = keyOf(rows[0])
  let last = first
  for (const row of rows) {
    const key = keyOf(row)
    if (key < first) first = key
    if (key > last) last = key
  }
  return [first, last]
}
