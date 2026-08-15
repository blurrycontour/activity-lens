import { describe, expect, it } from 'vitest'
import { type Workout } from '../../data/workouts'
import {
  CARD_H, cardDate, cardFilename, cardHeight, cardStats, cardWhen, projectRoute, statsLayout,
} from '../shareCard'

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
  // The order is the grid's reading order — time and distance on the first row,
  // the two sport-dependent figures on the second — and the card lays the tiles
  // out by index, so reordering here silently reorders the card.
  it('shows the four figures in grid order', () => {
    expect(cardStats(workout()).map(s => s.value))
      .toEqual(['30:00', '5.00 km', '145 bpm', '5:00 /km'])
  })

  // A dash, not a zero. "0:00 /km" is a number, and a reader takes it for one.
  it('marks a missing figure as absent rather than as zero', () => {
    const s = cardStats(workout({ avgPace: 0, avgHR: 0, distance: 0 }))
    expect(s.map(x => x.value)).toEqual(['30:00', '—', '—', '—'])
  })

  it('gives every figure an icon to draw', () => {
    expect(cardStats(workout()).every(s => typeof s.icon === 'object' || typeof s.icon === 'function')).toBe(true)
  })

  // Dropped rather than blanked: a tile reading "Avg HR —" prints the very
  // thing the sender chose to leave out.
  it('leaves heart rate out entirely when it is switched off', () => {
    const s = cardStats(workout(), { showHR: false })
    expect(s.map(x => x.label)).toEqual(['Time', 'Distance', 'Avg Pace'])
  })
})

/*
 * The card grows and shrinks with what is on it, and the preview is sized from
 * these numbers — so a wrong height here is a letterboxed or clipped preview of
 * an image that is itself fine, which is a confusing thing to debug.
 */
describe('card geometry', () => {
  it('keeps the full card exactly as it was', () => {
    // Every card sent before this existed is this size; a change here would
    // quietly reframe them all.
    expect(cardHeight(workout())).toBe(CARD_H)
  })

  it('is shorter without the route', () => {
    expect(cardHeight(workout(), { showRoute: false })).toBeLessThan(CARD_H)
  })

  it('is shorter again with one fewer figure', () => {
    const noRoute = cardHeight(workout(), { showRoute: false })
    expect(cardHeight(workout(), { showRoute: false, showHR: false })).toBeLessThan(noRoute)
  })

  // Three in a 2×2 grid leaves a hole, and a hole reads as something that
  // failed to draw.
  it('grids four figures and lists fewer', () => {
    expect(statsLayout(4)).toBe('grid')
    expect(statsLayout(3)).toBe('list')
    expect(statsLayout(1)).toBe('list')
  })
})

/*
 * The time of day is optional all the way from the database up, and a card that
 * printed "00:00" for a workout that never recorded one would be stating
 * something false rather than omitting something unknown.
 */
describe('cardWhen', () => {
  it('appends the time when there is one', () => {
    const s = cardWhen(workout({ startTime: '2025-07-12T07:42:00Z' }))
    expect(s.startsWith(cardDate('2025-07-12'))).toBe(true)
    expect(s).toContain('·')
  })

  it('is the date alone when the server sent no start time', () => {
    expect(cardWhen(workout())).toBe(cardDate('2025-07-12'))
  })

  it('ignores a start time it cannot parse', () => {
    expect(cardWhen(workout({ startTime: 'nonsense' }))).toBe(cardDate('2025-07-12'))
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
