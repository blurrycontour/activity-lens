import { describe, expect, it } from 'vitest'
import { goalProgress, newGoal, weekStartKey, type Goal } from '../insights'
import type { Workout } from '../../data/workouts'

function workout(date: string, distance: number, type: Workout['type'] = 'Run'): Workout {
  return {
    id: date + distance, name: 'w', type, date, duration: 1800, distance,
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
  const goal: Goal = { ...newGoal(), count: 2, period: 'week', type: 'Run', minKm: 5 }

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
})
