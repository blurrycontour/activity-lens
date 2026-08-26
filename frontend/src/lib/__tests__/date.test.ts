import { describe, it, expect, vi, afterEach } from 'vitest'
import { isActiveNow, lastActive, lastUsed, relativeDay, whenLabel, shortDate } from '../date'

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

/*
 * The "now" window is coupled to seenInterval in the backend's sessiontrack.go,
 * which is how often a session's last-seen is actually written. Two constants in
 * two languages that have to stay in a fixed relationship is exactly the kind of
 * pair that drifts, so the boundary is pinned here — and the case just past it
 * is what someone sitting in the app would see if it ever did.
 */
describe('lastActive', () => {
  it('calls the last two minutes "now" and counts from there', () => {
    at('2026-08-25T12:00:00Z')
    expect(lastActive('2026-08-25T11:59:00Z')).toBe('Active now')
    expect(lastActive('2026-08-25T11:58:30Z')).toBe('Active now')
    // Past the window, and no gap: the minute count picks up where "now" stops.
    expect(lastActive('2026-08-25T11:57:00Z')).toBe('Last active 3 min ago')
    expect(lastActive('2026-08-25T09:00:00Z')).toBe('Last active 3 hours ago')
    expect(lastActive('2026-08-18T12:00:00Z')).toBe('Last active 7 days ago')
    expect(lastActive('2026-03-04T09:00:00Z')).toMatch(/^Last active /)
  })

  // Absent is "we do not know", not "never" — the two look the same from the
  // server and only one of them is a claim about a person.
  it('says nothing at all without a time', () => {
    at('2026-08-25T12:00:00Z')
    expect(lastActive(undefined)).toBe('')
    expect(lastActive('not a date')).toBe('')
    expect(isActiveNow(undefined)).toBe(false)
  })

  it('agrees with isActiveNow on both sides of the window', () => {
    at('2026-08-25T12:00:00Z')
    expect(isActiveNow('2026-08-25T11:59:00Z')).toBe(true)
    expect(isActiveNow('2026-08-25T11:57:00Z')).toBe(false)
  })

  it('describes a session timestamp as last used', () => {
    at('2026-08-25T12:00:00Z')
    expect(lastUsed('2026-08-25T11:59:00Z')).toBe('Active now')
    expect(lastUsed('2026-08-18T12:00:00Z')).toBe('Last used 7 days ago')
  })
})
