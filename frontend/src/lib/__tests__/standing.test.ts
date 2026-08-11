import { describe, expect, it } from 'vitest'
import { sessionStanding } from '../standing'
import type { Workout, WorkoutType } from '../../data/workouts'

/**
 * The panel this feeds is the only thing a GPS-less, HR-less workout gets, so
 * a wrong fact here is not a cosmetic slip — it is the whole page being wrong.
 * Ranking and windowing are also exactly the sort of logic that looks right and
 * counts one off.
 */

function w(over: Partial<Workout> & { id: string; date: string }): Workout {
  return {
    type: 'Run' as WorkoutType,
    distance: 0,
    duration: 0,
    ...over,
  } as Workout
}

describe('sessionStanding', () => {
  it('says nothing when there is nothing to compare against', () => {
    const only = w({ id: 'a', date: '2026-01-10', duration: 1800 })
    expect(sessionStanding([only], only)).toEqual([])
  })

  it('ignores other sports when ranking', () => {
    const subject = w({ id: 'a', date: '2026-01-10', type: 'Strength', duration: 1800 })
    const all = [
      subject,
      w({ id: 'b', date: '2026-01-08', type: 'Strength', duration: 900 }),
      // Longer, and irrelevant: a ride is not a strength session.
      w({ id: 'c', date: '2026-01-09', type: 'Ride', duration: 7200 }),
    ]
    const rank = sessionStanding(all, subject).find(s => s.label.startsWith('Longest'))
    expect(rank?.value).toBe('Your longest')
    expect(rank?.hint).toBe('of 2')
  })

  it('ranks by distance when there is one, and by duration when there is not', () => {
    // Longest by time, shortest by distance — the two orderings disagree, which
    // is the case that catches picking the wrong measure.
    const subject = w({ id: 'a', date: '2026-01-10', distance: 3000, duration: 5400 })
    const all = [
      subject,
      w({ id: 'b', date: '2026-01-09', distance: 9000, duration: 1800 }),
      w({ id: 'c', date: '2026-01-08', distance: 6000, duration: 1200 }),
    ]
    expect(sessionStanding(all, subject)[0].value).toBe('3rd longest')

    const noDistance = w({ id: 'a', date: '2026-01-10', duration: 5400 })
    const byTime = [noDistance, w({ id: 'b', date: '2026-01-09', duration: 1800 })]
    expect(sessionStanding(byTime, noDistance)[0].value).toBe('Your longest')
  })

  it('counts only workouts that have the measure at all', () => {
    const subject = w({ id: 'a', date: '2026-01-10', distance: 5000 })
    const all = [
      subject,
      w({ id: 'b', date: '2026-01-09', distance: 8000 }),
      // No distance recorded: it cannot be ranked against, so it must not
      // inflate the denominator either.
      w({ id: 'c', date: '2026-01-08', duration: 3600 }),
    ]
    const rank = sessionStanding(all, subject)[0]
    expect(rank.value).toBe('2nd longest')
    expect(rank.hint).toBe('of 2')
  })

  it('measures the gap to the previous session, not to today', () => {
    const subject = w({ id: 'a', date: '2026-01-10', duration: 1800 })
    const all = [
      subject,
      w({ id: 'b', date: '2026-01-03', duration: 1800 }),
      // Later than the subject: not "the last one before it".
      w({ id: 'c', date: '2026-02-01', duration: 1800 }),
    ]
    const gap = sessionStanding(all, subject, new Date('2026-06-01')).find(s => s.label.startsWith('Since'))
    expect(gap?.value).toBe('7 days')
  })

  it('drops the this-month count for a workout that is not recent', () => {
    const subject = w({ id: 'a', date: '2026-01-10', duration: 1800 })
    const all = [subject, w({ id: 'b', date: '2026-01-04', duration: 1800 })]
    const labels = (now: Date) => sessionStanding(all, subject, now).map(s => s.label)
    expect(labels(new Date('2026-01-12T12:00:00Z'))).toContain('This month')
    expect(labels(new Date('2026-06-01T12:00:00Z'))).not.toContain('This month')
  })

  it('uses the correct ordinal for the teens', () => {
    const subject = w({ id: 'x', date: '2026-01-10', duration: 100 })
    // Ten longer sessions plus the subject puts it 11th, which is where a naive
    // "1 → st" rule produces "11st".
    const all = [subject, ...Array.from({ length: 10 }, (_, i) =>
      w({ id: `o${i}`, date: '2026-01-01', duration: 1000 + i }))]
    expect(sessionStanding(all, subject)[0].value).toBe('11th longest')
  })
})
