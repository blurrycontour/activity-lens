import { describe, expect, it } from 'vitest'
import { FIELD_H, FIELD_W, VARIANTS, buildConstellation, normalise } from '../constellation'

/**
 * Two promises this makes that nothing else can check: the same workout always
 * draws the same picture, and different workouts draw different ones. Both fail
 * silently — a broken seed gives a perfectly nice drawing that simply is not
 * the one this workout had yesterday.
 */

const flat = Array.from({ length: 110 }, () => 0.5)

describe('buildConstellation', () => {
  it('is a pure function of the seed', () => {
    const a = buildConstellation('workout-abc', flat)
    const b = buildConstellation('workout-abc', flat)
    expect(a).toEqual(b)
  })

  it('draws different workouts differently', () => {
    const ids = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7', 'h8']
    const drawings = ids.map(id => JSON.stringify(buildConstellation(id, flat)))
    expect(new Set(drawings).size).toBe(ids.length)
    // …and not merely by the star field: the trajectories differ too.
    const paths = ids.map(id => JSON.stringify(buildConstellation(id, flat).points))
    expect(new Set(paths).size).toBe(ids.length)
  })

  it('uses every variant across a spread of ids', () => {
    const seen = new Set(
      Array.from({ length: 60 }, (_, i) => buildConstellation(`workout-${i}`, flat).variant),
    )
    expect(seen.size).toBe(VARIANTS.length)
  })

  it('starts at the lower left and ends at the upper right', () => {
    // The one thing that must never vary: it is what makes the drawing
    // readable as a journey without a single label on it.
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const { points } = buildConstellation(id, flat)
      const first = points[0]
      const last = points[points.length - 1]
      expect(first.x).toBeLessThan(last.x)
      expect(first.y).toBeGreaterThan(last.y)
    }
  })

  it('keeps the path on the field even at the extremes of the metric', () => {
    // A workout that pins the modulation to either end is what pushes the path
    // furthest off its curve, and a path that leaves the viewBox is clipped.
    const spikes = Array.from({ length: 110 }, (_, i) => (i % 2 === 0 ? 0 : 1))
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      for (const p of buildConstellation(id, spikes).points) {
        expect(p.x).toBeGreaterThanOrEqual(0)
        expect(p.x).toBeLessThanOrEqual(FIELD_W)
        expect(p.y).toBeGreaterThanOrEqual(0)
        expect(p.y).toBeLessThanOrEqual(FIELD_H)
      }
    }
  })

  it('draws a plain curve when nothing was recorded', () => {
    const bare = buildConstellation('x', [])
    const mid = buildConstellation('x', flat)
    // An empty series and a dead-flat one both sit at the middle of the range,
    // so neither pushes the path off its curve — the drawing is the same.
    expect(bare.points).toEqual(mid.points)
  })
})

describe('normalise', () => {
  it('scales to the series own range', () => {
    const series = [{ t: 0, v: 100 }, { t: 50, v: 150 }, { t: 100, v: 200 }]
    const out = normalise(series, 100, p => p.t, p => p.v, 3)
    expect(out).toEqual([0, 0.5, 1])
  })

  it('gives a flat series a flat result rather than dividing by zero', () => {
    const series = [{ t: 0, v: 140 }, { t: 100, v: 140 }]
    expect(normalise(series, 100, p => p.t, p => p.v, 3)).toEqual([0, 0, 0])
  })

  it('returns nothing to modulate with when there is no series', () => {
    expect(normalise([], 100, () => 0, () => 0)).toEqual([])
  })
})
