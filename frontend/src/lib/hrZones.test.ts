import { describe, expect, it } from 'vitest'
import { HR_ZONE_COLORS, hrZoneBuckets, hrZoneCounter, hrZoneStops } from './hrZones'

const MAX = 200
// One sample per zone: 50%, 65%, 75%, 85%, 95% of a 200bpm maximum.
const timeline = [
  { t: 0, hr: 100 },
  { t: 10, hr: 130 },
  { t: 20, hr: 150 },
  { t: 30, hr: 170 },
  { t: 40, hr: 190 },
]

describe('hrZoneCounter', () => {
  // The counter replaced a filter-and-recount, so it has to agree with the
  // thing it replaced at every point, not just at the end.
  it('matches hrZoneBuckets at every cut point', () => {
    const countTo = hrZoneCounter(timeline, MAX)
    for (const t of [-1, 0, 5, 10, 25, 40, 999]) {
      const expected = hrZoneBuckets(timeline.filter(p => p.t <= t), MAX, timeline.length)
      const actual = countTo(t)
      expect(actual.map(z => z.value)).toEqual(expected.length ? expected.map(z => z.value) : [0, 0, 0, 0, 0])
      if (expected.length) expect(actual.map(z => z.pct)).toEqual(expected.map(z => z.pct))
    }
  })

  it('counts nothing before the first sample and everything after the last', () => {
    const countTo = hrZoneCounter(timeline, MAX)
    expect(countTo(-1).map(z => z.value)).toEqual([0, 0, 0, 0, 0])
    expect(countTo(1000).map(z => z.value)).toEqual([1, 1, 1, 1, 1])
  })

  it('puts each sample in the zone its percentage falls in', () => {
    const countTo = hrZoneCounter(timeline, MAX)
    expect(countTo(0).map(z => z.value)).toEqual([1, 0, 0, 0, 0])
    expect(countTo(20).map(z => z.value)).toEqual([1, 1, 1, 0, 0])
  })

  // Shares are of the whole activity, so the bars grow rather than
  // rearranging themselves while playback runs.
  it('keeps percentages relative to the whole activity', () => {
    const countTo = hrZoneCounter(timeline, MAX)
    expect(countTo(0).map(z => z.pct)).toEqual([20, 0, 0, 0, 0])
  })

  it('returns nothing without a usable maximum or samples', () => {
    expect(hrZoneCounter(timeline, 0)(40)).toEqual([])
    expect(hrZoneCounter([], MAX)(40)).toEqual([])
  })
})

describe('heart-rate reserve zones', () => {
  it('uses resting heart rate in the Karvonen intensity', () => {
    const points = [{ t: 0, hr: 130 }, { t: 1, hr: 140 }]
    expect(hrZoneBuckets(points, 200).map(z => z.value)).toEqual([0, 1, 1, 0, 0])
    expect(hrZoneBuckets(points, 200, undefined, 50, 'reserve').map(z => z.value))
      .toEqual([1, 1, 0, 0, 0])
  })

  it('falls back to max-HR zones without a usable resting HR', () => {
    const points = [{ t: 0, hr: 130 }]
    expect(hrZoneBuckets(points, 200, undefined, 0, 'reserve'))
      .toEqual(hrZoneBuckets(points, 200))
  })
})

// The stops are an objectBoundingBox gradient over the drawn line, so they must
// span exactly the line's value range and never invent a zone above its peak —
// that mismatch was what drew a Zone-4 peak in the Zone-5 colour with no Zone-5
// sample behind it.
describe('hrZoneStops', () => {
  const [Z1, , , Z4, Z5] = HR_ZONE_COLORS

  it('never colours above the data peak with a higher zone', () => {
    // Peak 173 of a 195 ceiling is 88.7% — Zone 4, not Zone 5.
    const stops = hrZoneStops(79, 173, 195)!
    expect(stops).not.toBeNull()
    expect(stops[0].color).toBe(Z4)
    expect(stops.some(s => s.color === Z5)).toBe(false)
    expect(stops[stops.length - 1].color).toBe(Z1)
  })

  it('spans the whole line range, top zone at the top', () => {
    // 190 of 195 is 97% — Zone 5 genuinely present.
    const stops = hrZoneStops(90, 190, 195)!
    expect(stops[0].color).toBe(Z5)
  })

  it('gives up on a flat line or a missing maximum', () => {
    expect(hrZoneStops(150, 150, 195)).toBeNull()
    expect(hrZoneStops(80, 170, 0)).toBeNull()
  })
})
