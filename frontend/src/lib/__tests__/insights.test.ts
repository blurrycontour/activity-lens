import { describe, expect, it } from 'vitest'
import {
  goalProgress, newGoal, parseDateKey, periodKeyOf, periodLabel, recentPersonalBests, sparkAverages,
  weekStartKey, type Goal,
} from '../insights'
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

describe('elapsed', () => {
  // The Pace and Rings styles put a marker at `elapsed` on the bar. If it were
  // measured against the wrong window the marker would sit in the wrong place
  // all week, and the panel would confidently tell you the opposite of the
  // truth — worse than not showing it at all.
  it('measures how far through the current week has gone', () => {
    const g: Goal = { ...newGoal(), target: 3, period: 'week' }
    // Thursday midday: 3.5 of 7 days used.
    const p = goalProgress([], g, 8, new Date(2026, 6, 30, 12, 0))
    expect(p.elapsed).toBeCloseTo(3.5 / 7, 2)
  })

  it('measures a month against that month’s real length', () => {
    const g: Goal = { ...newGoal(), target: 40, period: 'month' }
    // 15 February of a 28-day month is further through it than 15 March is
    // through a 31-day one; a fixed 30-day assumption gets both wrong.
    const feb = goalProgress([], g, 8, new Date(2026, 1, 15))
    const mar = goalProgress([], g, 8, new Date(2026, 2, 15))
    expect(feb.elapsed).toBeCloseTo(14 / 28, 2)
    expect(mar.elapsed).toBeCloseTo(14 / 31, 2)
    expect(feb.elapsed).toBeGreaterThan(mar.elapsed)
  })

  it('spreads across a multi-period window rather than repeating each period', () => {
    // A 3-week goal one week in is a third done, not a whole one.
    const g: Goal = { ...newGoal(), target: 3, period: 'week', span: 3 }
    const start = parseDateKey(periodKeyOf('2026-07-27', g))
    const oneWeekIn = new Date(start)
    oneWeekIn.setDate(oneWeekIn.getDate() + 7)
    expect(goalProgress([], g, 4, oneWeekIn).elapsed).toBeCloseTo(1 / 3, 2)
  })

  it('never leaves 0..1', () => {
    const g: Goal = { ...newGoal(), target: 3, period: 'week' }
    const monday = goalProgress([], g, 8, new Date(2026, 6, 27, 0, 0))
    expect(monday.elapsed).toBe(0)
    expect(monday.elapsed).toBeLessThanOrEqual(1)
  })
})

describe('periodLabel', () => {
  // The ISO rule puts the week containing the year's first Thursday at 1, which
  // is what a Monday-anchored week needs. Counting days from January 1 instead
  // disagrees around every new year — exactly where a wrong label is most
  // obviously wrong.
  it('numbers weeks the ISO way across a year boundary', () => {
    expect(periodLabel('2025-12-29', 'week')).toBe('W1') // Mon of the week holding 1 Jan 2026
    expect(periodLabel('2026-01-05', 'week')).toBe('W2')
    expect(periodLabel('2026-07-27', 'week')).toBe('W31')
  })

  it('names months', () => {
    expect(periodLabel('2026-07', 'month')).toBe('Jul')
    expect(periodLabel('2026-01', 'month')).toBe('Jan')
    expect(periodLabel('2026-12', 'month')).toBe('Dec')
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


/**
 * The heart-rate stat card had no sparkline at all, because the summing
 * version would have drawn one that meant nothing — a total of everyone's
 * average bpm. These are the three things the averaging version has to get
 * right for the line to be honest.
 */
describe('sparkAverages', () => {
  function hrWorkout(date: string, hr: number): Workout {
    return { ...workout(date, 5000), avgHR: hr }
  }

  it('averages within a bucket rather than adding', () => {
    const now = new Date(2026, 6, 29)
    // Two buckets over eight days: two runs in the first, one in the second.
    const out = sparkAverages(
      [hrWorkout('2026-07-22', 140), hrWorkout('2026-07-23', 160), hrWorkout('2026-07-28', 150)],
      8, 2, w => w.avgHR, now,
    )
    expect(out).toEqual([150, 150])
  })

  it('carries a quiet bucket forward instead of dropping to zero', () => {
    const now = new Date(2026, 6, 29)
    // A rest week in the middle must not draw a plunge to the floor and back;
    // that is a collapse that never happened.
    const out = sparkAverages(
      [hrWorkout('2026-07-22', 140), hrWorkout('2026-07-28', 150)],
      8, 4, w => w.avgHR, now,
    )
    expect(out.every(v => v > 0)).toBe(true)
    expect(out[0]).toBe(140)
    expect(out[out.length - 1]).toBe(150)
  })

  it('says nothing when there is barely anything to say', () => {
    const now = new Date(2026, 6, 29)
    // One reading is a straight line pretending to be a trend, and a workout
    // with no monitor reports 0, which is "not measured" rather than a value.
    expect(sparkAverages([hrWorkout('2026-07-28', 150)], 8, 4, w => w.avgHR, now)).toEqual([])
    expect(sparkAverages([hrWorkout('2026-07-22', 0), hrWorkout('2026-07-28', 0)], 8, 4, w => w.avgHR, now)).toEqual([])
  })
})

describe('recentPersonalBests', () => {
  const NOW = new Date('2026-08-25T12:00:00Z')

  /** A workout with a pace and an optional start time, for the tie-break case. */
  function paced(date: string, type: Workout['type'], avgPace: number, startTime?: string): Workout {
    return { ...workout(date, 5000, type), id: date + type + avgPace, avgPace, startTime }
  }

  // Judging a hike against hikes is right — a hike is not slow for being slower
  // than a run — but the label has to say so. Unqualified, "Fastest pace" beside
  // a hiking pace is a claim about all your training, and a reader who ran
  // faster last week knows it is false.
  it('names the sport in every label', () => {
    const hikes = [
      paced('2026-08-24', 'Hike', 850),
      paced('2026-08-08', 'Hike', 954),
      paced('2026-01-03', 'Hike', 972),
      paced('2025-12-28', 'Hike', 1020),
    ]
    const bests = recentPersonalBests(hikes, 3, 14, NOW)
    const pace = bests.find(b => b.kind === 'pace')
    expect(pace?.label).toBe('Fastest Hike pace')
    for (const b of bests) expect(b.label).toContain('Hike')
  })

  // A faster run of another sport must not suppress a genuine hiking record,
  // and must not be borrowed to claim one either.
  it('judges against the same sport only', () => {
    const mixed = [
      paced('2026-08-24', 'Hike', 850),
      paced('2026-08-08', 'Hike', 954),
      paced('2026-01-03', 'Hike', 972),
      paced('2025-12-28', 'Hike', 1020),
      paced('2026-06-10', 'Run', 420),
    ]
    expect(recentPersonalBests(mixed, 3, 14, NOW).find(b => b.kind === 'pace')?.value).toBe('14:10 /km')
  })

  // A ride and a swim report avgSpeed and no avgPace, so a function that only
  // looked at pace gave half the sports the app supports no record at all.
  it('records a speed best for the sports that have no pace', () => {
    const ride = (date: string, avgSpeed: number): Workout =>
      ({ ...workout(date, 20000, 'Ride'), id: date + avgSpeed, avgPace: 0, avgSpeed })
    const rides = [ride('2026-08-24', 31), ride('2026-08-10', 26), ride('2026-07-02', 28), ride('2026-06-01', 24)]
    const best = recentPersonalBests(rides, 3, 14, NOW).find(b => b.kind === 'speed')
    expect(best?.label).toBe('Fastest Ride')
    expect(best?.value).toBe('31.0 km/h')
  })

  // The two must never both fire: they are the same claim in different units.
  it('does not report both a pace and a speed best for one workout', () => {
    const runs = [
      paced('2026-08-24', 'Run', 420),
      paced('2026-08-10', 'Run', 460),
      paced('2026-07-02', 'Run', 455),
      paced('2026-06-01', 'Run', 470),
    ].map(w => ({ ...w, avgSpeed: 3600 / w.avgPace }))
    const kinds = recentPersonalBests(runs, 3, 14, NOW).map(b => b.kind)
    expect(kinds).toContain('pace')
    expect(kinds).not.toContain('speed')
  })

  // The one record on the card that cannot be set by trying harder on the day.
  it('records the efficiency best when the same HR buys more speed', () => {
    const w = (date: string, avgHR: number, avgSpeed: number): Workout =>
      ({ ...workout(date, 5000, 'Run'), id: date + avgHR, avgHR, avgSpeed, avgPace: 0 })
    // 150/12 = 12.5, below every peer, while the HR itself is not the lowest.
    const runs = [w('2026-08-24', 150, 12), w('2026-08-10', 140, 10), w('2026-07-02', 155, 11), w('2026-06-01', 145, 10)]
    const best = recentPersonalBests(runs, 3, 14, NOW).find(b => b.kind === 'efficiency')
    expect(best?.label).toBe('Best Run efficiency')
    expect(best?.value).toBe('12.5 bpm per km/h')
  })

  // Going slowly must not look like getting fitter: the record is HR per unit
  // of speed, not HR.
  it('does not call the slowest workout the most efficient', () => {
    const w = (date: string, avgHR: number, avgSpeed: number): Workout =>
      ({ ...workout(date, 5000, 'Run'), id: date + avgHR, avgHR, avgSpeed, avgPace: 0 })
    // Lowest HR of the four, but crawling: 100/5 = 20 is the worst ratio here.
    const runs = [w('2026-08-24', 100, 5), w('2026-08-10', 140, 10), w('2026-07-02', 155, 11), w('2026-06-01', 145, 10)]
    expect(recentPersonalBests(runs, 3, 14, NOW).find(b => b.kind === 'efficiency')).toBeUndefined()
  })

  // `date` is a day, so two workouts on one day sort equal and "the most recent"
  // used to be whichever the API returned first. The evening hike is the latest
  // workout whatever order the list arrives in.
  it('breaks a same-day tie on the start time', () => {
    const sameDay = [
      paced('2026-08-24', 'Run', 494, '2026-08-24T08:41:00Z'),
      paced('2026-08-24', 'Hike', 850, '2026-08-24T16:52:00Z'),
      paced('2026-08-08', 'Hike', 954),
      paced('2026-01-03', 'Hike', 972),
      paced('2025-12-28', 'Hike', 1020),
    ]
    const forwards = recentPersonalBests(sameDay, 3, 14, NOW)
    const backwards = recentPersonalBests([...sameDay].reverse(), 3, 14, NOW)
    expect(forwards.find(b => b.kind === 'pace')?.label).toBe('Fastest Hike pace')
    expect(backwards).toEqual(forwards)
  })
})
