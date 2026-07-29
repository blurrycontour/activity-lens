import { describe, expect, it } from 'vitest'
import { filterByRange, rangeStartDate, toDateKey } from '../range'

describe('toDateKey', () => {
  it('uses local time, not UTC', () => {
    // The whole reason this helper exists: toISOString() would roll a late
    // evening back to the previous day for anyone east of UTC, silently
    // misfiling workouts by a day.
    const d = new Date(2026, 6, 29, 23, 30)
    expect(toDateKey(d)).toBe('2026-07-29')
  })

  it('pads single-digit months and days', () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('rangeStartDate', () => {
  it('is inclusive of today, so "last 7 days" spans 7 dates', () => {
    const now = new Date(2026, 6, 29)
    expect(rangeStartDate(7, now)).toBe('2026-07-23')
  })

  it('returns null for all-time', () => {
    expect(rangeStartDate(0)).toBeNull()
  })
})

describe('filterByRange', () => {
  const items = [
    { date: '2026-07-29' },
    { date: '2026-07-23' },
    { date: '2026-07-22' },
  ]

  it('keeps the boundary date and drops the one before it', () => {
    expect(filterByRange(items, 7, new Date(2026, 6, 29))).toEqual([
      { date: '2026-07-29' },
      { date: '2026-07-23' },
    ])
  })

  it('keeps everything for all-time', () => {
    expect(filterByRange(items, 0)).toHaveLength(3)
  })
})
