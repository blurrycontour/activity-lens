import { describe, expect, it } from 'vitest'
import { hrZoneBuckets, hrZoneCounter } from './hrZones'

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
