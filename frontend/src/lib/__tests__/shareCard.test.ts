import { describe, expect, it } from 'vitest'
import { type Workout } from '../../data/workouts'
import { cardDate, cardFilename, cardStats, projectRoute } from '../shareCard'

const BOX = { x: 0, y: 0, w: 100, h: 100 }

/*
 * The projection is the part with a wrong answer that still draws a plausible
 * line: get the longitude scaling wrong and every route is stretched sideways
 * by 1/cos(latitude), which looks like a route, just not yours.
 */
describe('projectRoute', () => {
  it('keeps the aspect ratio of a square at the equator', () => {
    // One degree each way at the equator is very nearly square.
    const pts = projectRoute([[0, 0], [0, 1], [1, 1], [1, 0]], BOX)
    const xs = pts.map(p => p[0])
    const ys = pts.map(p => p[1])
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(100, 0)
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(100, 0)
  })

  // At 60°N a degree of longitude is half a degree of latitude on the ground,
  // so an equal-degree box is a wide rectangle and must be drawn as one.
  it('narrows longitude away from the equator', () => {
    const pts = projectRoute([[60, 0], [60, 1], [61, 1], [61, 0]], BOX)
    const xs = pts.map(p => p[0])
    const ys = pts.map(p => p[1])
    const spanX = Math.max(...xs) - Math.min(...xs)
    const spanY = Math.max(...ys) - Math.min(...ys)
    expect(spanX / spanY).toBeCloseTo(0.5, 1)
  })

  it('puts north at the top', () => {
    const [south, north] = projectRoute([[10, 0], [11, 0]], BOX)
    expect(north[1]).toBeLessThan(south[1])
  })

  it('fits inside the box it was given', () => {
    for (const p of projectRoute([[51.5, -0.12], [51.52, -0.1], [51.49, -0.15]], BOX)) {
      expect(p[0]).toBeGreaterThanOrEqual(BOX.x)
      expect(p[0]).toBeLessThanOrEqual(BOX.x + BOX.w)
      expect(p[1]).toBeGreaterThanOrEqual(BOX.y)
      expect(p[1]).toBeLessThanOrEqual(BOX.y + BOX.h)
    }
  })

  // A treadmill lap recorded with one stuck fix has no extent at all; dividing
  // by that span would put every point at NaN and draw nothing, silently.
  it('survives a route with no extent', () => {
    for (const p of projectRoute([[51.5, -0.12], [51.5, -0.12]], BOX)) {
      expect(Number.isFinite(p[0])).toBe(true)
      expect(Number.isFinite(p[1])).toBe(true)
    }
  })

  it('returns nothing for an empty route rather than throwing', () => {
    expect(projectRoute([], BOX)).toEqual([])
  })
})

function workout(over: Partial<Workout> = {}): Workout {
  return {
    id: 'w1', name: 'Morning Run', type: 'Run', date: '2025-07-12',
    duration: 1800, distance: 5000, avgHR: 145, maxHR: 170, avgPace: 300,
    elevationGain: 20, calories: 300, avgSpeed: 10, route: [],
    hrTimeline: [], paceTimeline: [], elevTimeline: [], notes: '',
    ...over,
  } as Workout
}

describe('cardStats', () => {
  it('shows the four figures', () => {
    expect(cardStats(workout()).map(s => s.value))
      .toEqual(['5.00 km', '30:00', '5:00 /km', '145 bpm'])
  })

  // A dash, not a zero. "0:00 /km" is a number, and a reader takes it for one.
  it('marks a missing figure as absent rather than as zero', () => {
    const s = cardStats(workout({ avgPace: 0, avgHR: 0, distance: 0 }))
    expect(s.map(x => x.value)).toEqual(['—', '30:00', '—', '—'])
  })
})

describe('cardFilename', () => {
  it('leads with the date, so cards sort by when they happened', () => {
    expect(cardFilename(workout(), 'png')).toBe('2025-07-12-morning-run.png')
  })

  // The name is free text from a device: it reaches a filesystem, so anything
  // that could be a path separator or a shell surprise has to go.
  it('strips everything a filename should not carry', () => {
    expect(cardFilename(workout({ name: '../../etc/passwd' }), 'jpeg'))
      .toBe('2025-07-12-etc-passwd.jpeg')
    expect(cardFilename(workout({ name: '🏃‍♂️' }), 'png')).toBe('2025-07-12-workout.png')
  })
})

describe('cardDate', () => {
  it('gives back an unparseable date rather than "Invalid Date"', () => {
    expect(cardDate('not a date')).toBe('not a date')
  })
})
