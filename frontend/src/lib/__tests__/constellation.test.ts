import { describe, expect, it } from 'vitest'
import { FIELD_H, FIELD_W, VARIANTS, buildConstellation, normalise, pointAt, smooth } from '../constellation'

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

describe('smooth', () => {
  it('takes the jitter out and leaves the shape in', () => {
    // A slow rise with a one-point spike on every step: the rise has to
    // survive and the spike has to go, which is the whole trade.
    const noisy = Array.from({ length: 60 }, (_, i) => i / 59 + (i % 2 ? 0.25 : -0.25))
    const out = smooth(noisy)
    // Still rising overall.
    expect(out[50]).toBeGreaterThan(out[10])
    // And no longer alternating: every step is small compared with the ±0.5
    // swing the raw series had.
    for (let i = 1; i < out.length; i++) {
      expect(Math.abs(out[i] - out[i - 1])).toBeLessThan(0.1)
    }
  })

  it('leaves a series no longer than the window alone', () => {
    // Averaging every point against every other one does not smooth a shape,
    // it erases it — and normalise() is called with as few as three points.
    expect(smooth([0, 0.5, 1])).toEqual([0, 0.5, 1])
  })
})

describe('pointAt', () => {
  it('reads between the stored points', () => {
    // The playhead used to snap to the nearest of 110, which next to the map's
    // continuously moving marker looked broken.
    const { points } = buildConstellation('a', [])
    const a = pointAt(points, 0.5)!
    const b = pointAt(points, 0.5 + 1 / (points.length - 1) / 2)!
    expect(b.x).not.toBe(a.x)
    // And strictly between its two neighbours, not past them.
    const i = Math.floor(0.5 * (points.length - 1))
    expect(a.x).toBeGreaterThanOrEqual(Math.min(points[i].x, points[i + 1].x))
    expect(a.x).toBeLessThanOrEqual(Math.max(points[i].x, points[i + 1].x))
  })

  it('clamps to the ends rather than running off them', () => {
    const { points } = buildConstellation('a', [])
    expect(pointAt(points, -1)).toEqual(points[0])
    expect(pointAt(points, 2)).toEqual(points[points.length - 1])
    expect(pointAt([], 0.5)).toBeNull()
  })
})

describe('the finish', () => {
  it('does not kick at the last point', () => {
    // The bug: the tangent was taken by stepping forward, which at t = 1 is a
    // step of nothing — so the normal was zero, the swerve vanished, and the
    // final point snapped back onto the bare curve while its neighbour kept a
    // full push. It showed as a sharp drop at the finish on every workout,
    // whatever the metric was doing there.
    const high = Array.from({ length: 110 }, () => 1)
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const { points } = buildConstellation(id, high)
      const n = points.length
      const gap = (i: number) => Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
      // The last step must be in the same league as the ones before it, not a
      // jump back to the curve.
      const typical = (gap(n - 5) + gap(n - 4) + gap(n - 3)) / 3
      expect(gap(n - 1)).toBeLessThan(typical * 3 + 1)
    }
  })
})
