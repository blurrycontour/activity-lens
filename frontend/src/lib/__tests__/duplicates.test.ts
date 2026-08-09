import { describe, expect, it } from 'vitest'
import { type Workout } from '../../data/workouts'
import { findDuplicateGroups, looksLikeSame, redundantIds } from '../duplicates'

/*
 * This is a heuristic whose output is fed straight into a delete flow, so both
 * directions of a wrong answer matter: a missed pair is a duplicate left in the
 * library, and a false pair is a real workout ticked for deletion.
 */

let seq = 0
function w(over: Partial<Workout> = {}): Workout {
  seq++
  return {
    id: `w${seq}`, name: `Workout ${seq}`, type: 'Run', date: '2025-07-12',
    createdAt: `2025-07-12T10:0${seq}:00Z`,
    duration: 1800, distance: 5000, avgHR: 145, maxHR: 170, avgPace: 300,
    elevationGain: 20, calories: 300, avgSpeed: 10, route: [],
    hrTimeline: [], paceTimeline: [], elevTimeline: [], notes: '',
    ...over,
  } as Workout
}

describe('looksLikeSame', () => {
  it('matches the same activity exported by two different apps', () => {
    // Different names, a few seconds of difference at each end, metres apart on
    // distance — which is exactly what two exporters do to one ride.
    expect(looksLikeSame(
      w({ name: 'Morning Run', duration: 1800, distance: 5000 }),
      w({ name: 'Run', duration: 1812, distance: 5043 }),
    )).toBe(true)
  })

  it('never matches a workout with itself', () => {
    const a = w()
    expect(looksLikeSame(a, a)).toBe(false)
  })

  it('separates different sports and different days', () => {
    expect(looksLikeSame(w(), w({ type: 'Ride' }))).toBe(false)
    expect(looksLikeSame(w(), w({ date: '2025-07-13' }))).toBe(false)
  })

  // Two 30-minute 5 km runs on one day is a plausible mistake to make; a 5 km
  // and an 8 km are two different runs and must never be offered for deletion.
  it('separates workouts of clearly different length', () => {
    expect(looksLikeSame(w({ distance: 5000 }), w({ distance: 8000 }))).toBe(false)
    expect(looksLikeSame(w({ duration: 1800 }), w({ duration: 3600 }))).toBe(false)
  })

  // A morning run and an evening run on the same day at the same distance are
  // a real pair, and the start time is the only thing that says so.
  it('separates workouts hours apart when both know when they started', () => {
    expect(looksLikeSame(
      w({ startTime: '2025-07-12T07:00:00Z' }),
      w({ startTime: '2025-07-12T18:00:00Z' }),
    )).toBe(false)
    expect(looksLikeSame(
      w({ startTime: '2025-07-12T07:00:00Z' }),
      w({ startTime: '2025-07-12T07:03:00Z' }),
    )).toBe(true)
  })

  // Strength sessions and treadmill runs have none. Requiring a distance match
  // would have quietly excluded every one of them.
  it('compares workouts with no distance on duration alone', () => {
    expect(looksLikeSame(
      w({ type: 'Strength', distance: 0, duration: 2400 }),
      w({ type: 'Strength', distance: 0, duration: 2410 }),
    )).toBe(true)
  })
})

describe('findDuplicateGroups', () => {
  it('finds nothing in a library with no duplicates', () => {
    expect(findDuplicateGroups([w(), w({ date: '2025-07-13' }), w({ type: 'Ride' })])).toEqual([])
  })

  // Chained on purpose: 1800 and 1900 are further apart than the tolerance, so
  // the third copy is only reachable through the second. Comparing everything
  // against the seed alone would leave it behind as a group of two plus a
  // stray, which is the same duplicate reported as not-a-duplicate.
  it('gathers a chain of copies into one group', () => {
    const groups = findDuplicateGroups([
      w({ duration: 1800 }), w({ duration: 1850 }), w({ duration: 1900 }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveLength(3)
  })

  it('keeps the earliest import at the head of a group', () => {
    const older = w({ createdAt: '2024-01-01T00:00:00Z' })
    const newer = w({ createdAt: '2025-01-01T00:00:00Z' })
    const groups = findDuplicateGroups([newer, older])
    expect(groups[0][0].id).toBe(older.id)
    expect(redundantIds(groups)).toEqual([newer.id])
  })

  it('never proposes removing every copy', () => {
    const groups = findDuplicateGroups([w(), w(), w()])
    const total = groups.reduce((n, g) => n + g.length, 0)
    expect(redundantIds(groups)).toHaveLength(total - groups.length)
  })

  it('handles an empty library', () => {
    expect(findDuplicateGroups([])).toEqual([])
  })
})
