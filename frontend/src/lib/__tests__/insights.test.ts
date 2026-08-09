import { describe, expect, it } from 'vitest'
import { goalProgress, newGoal, periodKeyOf, weekStartKey, type Goal } from '../insights'
import type { Workout } from '../../data/workouts'

function workout(date: string, distance: number, type: Workout['type'] = 'Run', duration = 1800): Workout {
  return {
    id: date + distance, name: 'w', type, date, duration, distance,
    avgHR: 0, maxHR: 0, elevationGain: 0, calories: 0, avgPace: 300, avgSpeed: 12,
    route: [], hrTimeline: [], paceTimeline: [], elevTimeline: [],
  }
}

describe('weekStartKey', () => {
  it('anchors weeks to Monday', () => {
    // Sunday must belong to the week that started six days earlier, not begin
    // a new one — Go and JS both count weeks from Sunday by default, which
    // would shift every weekly goal by a day.
    expect(weekStartKey('2026-07-26')).toBe('2026-07-20') // a Sunday
    expect(weekStartKey('2026-07-27')).toBe('2026-07-27') // the next Monday
  })
})

describe('goalProgress', () => {
  const goal: Goal = { ...newGoal(), target: 2, period: 'week', type: 'Run', minKm: 5 }

  it('counts a run stored just short of 5 km but displayed as 5.0 km', () => {
    // The bug this pins: GPS puts a "5 km" run at ~4,983 m. Comparing raw
    // metres rejected it while every screen in the app called it 5.0 km, so
    // the dashboard showed 0/2 on a week that visibly had runs in it.
    const now = new Date(2026, 6, 29) // Wednesday
    const p = goalProgress([workout('2026-07-27', 4983), workout('2026-07-28', 5200)], goal, 8, now)
    expect(p.current).toBe(2)
  })

  it('excludes activities genuinely under the distance', () => {
    const now = new Date(2026, 6, 29)
    const p = goalProgress([workout('2026-07-27', 4400)], goal, 8, now)
    expect(p.current).toBe(0)
  })

  it('excludes other activity types', () => {
    const now = new Date(2026, 6, 29)
    const p = goalProgress([workout('2026-07-27', 8000, 'Ride')], goal, 8, now)
    expect(p.current).toBe(0)
  })

  it('sums kilometres for a distance goal', () => {
    // "Hike 40 km a month": the target is the sum, not the activity count, so
    // three short hikes are 12 km of progress rather than 3.
    const g: Goal = { ...newGoal(), metric: 'distance', target: 40, period: 'month', type: 'Hike', minKm: 0 }
    const now = new Date(2026, 6, 29)
    const p = goalProgress([
      workout('2026-07-04', 5000, 'Hike'),
      workout('2026-07-11', 4000, 'Hike'),
      workout('2026-07-18', 3000, 'Hike'),
      workout('2026-06-30', 9000, 'Hike'), // last month, must not count
    ], g, 8, now)
    expect(p.current).toBe(12)
  })

  it('sums hours for a duration goal', () => {
    const g: Goal = { ...newGoal(), metric: 'duration', target: 30, period: 'month', type: 'Run', minKm: 0 }
    const now = new Date(2026, 6, 29)
    const p = goalProgress([
      workout('2026-07-04', 5000, 'Run', 3600),
      workout('2026-07-11', 4000, 'Run', 5400),
    ], g, 8, now)
    expect(p.current).toBe(2.5)
  })

  it('honours the duration minimum, and treats it as a per-activity qualifier', () => {
    // A 40 km hiking goal with a 45-minute floor: the long hike counts in full,
    // the ten-minute one is ignored entirely rather than partly credited.
    const g: Goal = { ...newGoal(), metric: 'distance', target: 40, period: 'month', type: 'Hike', minMinutes: 45 }
    const now = new Date(2026, 6, 29)
    const p = goalProgress([
      workout('2026-07-04', 12000, 'Hike', 5400),
      workout('2026-07-05', 3000, 'Hike', 600),
    ], g, 8, now)
    expect(p.current).toBe(12)
  })

  it('applies both minimums together when both are set', () => {
    const g: Goal = { ...newGoal(), metric: 'count', target: 3, period: 'week', type: '', minKm: 5, minMinutes: 30 }
    const now = new Date(2026, 6, 29)
    const p = goalProgress([
      workout('2026-07-27', 6000, 'Run', 2400), // passes both
      workout('2026-07-27', 6000, 'Run', 600),  // long enough in km, too short in time
      workout('2026-07-28', 2000, 'Run', 3600), // long enough in time, too short in km
    ], g, 8, now)
    expect(p.current).toBe(1)
  })

  it('honours the distance minimum on a distance goal', () => {
    // The minimum is a qualifier on each activity, not on the total: a 2 km
    // stroll should not chip away at a "40 km of proper hikes" goal.
    const g: Goal = { ...newGoal(), metric: 'distance', target: 40, period: 'month', type: 'Hike', minKm: 5 }
    const now = new Date(2026, 6, 29)
    const p = goalProgress([workout('2026-07-04', 8000, 'Hike'), workout('2026-07-05', 2000, 'Hike')], g, 8, now)
    expect(p.current).toBe(8)
  })
})

describe('multi-period windows', () => {
  // Windows longer than one period tile forward from a fixed anchor. If they
  // were measured back from "now" instead, the block a workout belongs to
  // would shift every day and no streak could ever be counted.
  it('puts every date in a 3-week window on the same anchored key', () => {
    const g = { period: 'week' as const, span: 3 }
    // Counting 3-week blocks from the epoch Monday lands one on 2026-07-13,
    // running through 2026-08-02. Every day inside it shares that key, and the
    // next block starts the day after — blocks tile, never overlap.
    expect(periodKeyOf('2026-07-13', g)).toBe('2026-07-13')
    expect(periodKeyOf('2026-07-27', g)).toBe('2026-07-13')
    expect(periodKeyOf('2026-08-02', g)).toBe('2026-07-13')
    expect(periodKeyOf('2026-08-03', g)).toBe('2026-08-03')
  })

  it('tiles 2-month windows from January so a year splits evenly', () => {
    const g = { period: 'month' as const, span: 2 }
    expect(periodKeyOf('2026-01-15', g)).toBe('2026-01')
    expect(periodKeyOf('2026-02-28', g)).toBe('2026-01')
    expect(periodKeyOf('2026-03-01', g)).toBe('2026-03')
    expect(periodKeyOf('2026-12-31', g)).toBe('2026-11')
  })

  it('leaves single-period keys exactly as they were', () => {
    expect(periodKeyOf('2026-07-29', { period: 'week', span: 1 })).toBe('2026-07-27')
    expect(periodKeyOf('2026-07-29', { period: 'month', span: 1 })).toBe('2026-07')
  })

  it('counts a streak across consecutive 2-week windows', () => {
    const g: Goal = { ...newGoal(), target: 1, period: 'week', span: 2, type: 'Run', minKm: 0 }
    const now = new Date(2026, 6, 29) // Wed 29 Jul 2026
    const current = periodKeyOf('2026-07-29', g)
    // One run in the current window and one in each of the two before it.
    const before = (weeks: number) => {
      const d = new Date(`${current}T00:00:00`)
      d.setDate(d.getDate() - weeks * 7)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    const p = goalProgress(
      [workout(current, 6000), workout(before(2), 6000), workout(before(4), 6000)],
      g, 4, now,
    )
    expect(p.current).toBe(1)
    expect(p.streak).toBe(3)
  })
})
