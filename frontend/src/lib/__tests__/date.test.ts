import { describe, it, expect, vi, afterEach } from 'vitest'
import { relativeDay, whenLabel, shortDate } from '../date'

const at = (iso: string) => { vi.useFakeTimers(); vi.setSystemTime(new Date(iso)) }
afterEach(() => vi.useRealTimers())

describe('relativeDay', () => {
  it('names the recent past', () => {
    at('2026-08-25T12:00:00Z')
    expect(relativeDay('2026-08-25T09:00:00Z')).toBe('today')
    expect(relativeDay('2026-08-24T09:00:00Z')).toBe('yesterday')
    expect(relativeDay('2026-08-22T09:00:00Z')).toBe('3 days ago')
  })

  // The bug this replaced: past a week it fell through to a bare
  // toLocaleDateString(), so the plans list showed "4 days ago" directly above
  // "8/17/2026" — the only M/D/YYYY anywhere in the app.
  it('falls back to the app’s short date, not a numeric one', () => {
    at('2026-08-25T12:00:00Z')
    const out = relativeDay('2026-08-01T09:00:00Z')
    expect(out).not.toMatch(/\d+\/\d+\/\d+/)
    expect(out).toMatch(/Aug/)
  })

  it('survives an unparseable date', () => {
    expect(relativeDay('not a date')).toBe('')
  })
})

describe('whenLabel', () => {
  it('keeps minute resolution while it still matters', () => {
    at('2026-08-25T12:00:00Z')
    expect(whenLabel('2026-08-25T11:59:40Z')).toBe('just now')
    expect(whenLabel('2026-08-25T11:20:00Z')).toBe('40m ago')
    expect(whenLabel('2026-08-25T09:00:00Z')).toBe('3h ago')
  })

  it('shares the same fallback as relativeDay', () => {
    at('2026-08-25T12:00:00Z')
    expect(whenLabel('2026-08-01T09:00:00Z')).toBe(relativeDay('2026-08-01T09:00:00Z'))
  })
})

describe('shortDate', () => {
  // The year is noise on this year's workouts and essential on last year's.
  it('shows the year only when it is not the current one', () => {
    at('2026-08-25T12:00:00Z')
    expect(shortDate(new Date('2026-03-04T00:00:00Z'))).not.toMatch(/2026/)
    expect(shortDate(new Date('2025-03-04T00:00:00Z'))).toMatch(/2025/)
  })
})
