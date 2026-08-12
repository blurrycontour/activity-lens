import { describe, expect, it } from 'vitest'
import { inlineTicks } from '../chartTicks'

/**
 * The two gridline values a phone draws in place of a y axis.
 *
 * Worth holding down because there is nothing on screen to check them against:
 * a tick that is subtly wrong still looks like a tick, and the failure mode the
 * first version had — both values bunched near the bottom of the range — reads
 * as a plot that tops out early rather than as a bug.
 */
describe('inlineTicks', () => {
  /** No tick may sit on or outside the domain's edges. */
  function insideBand([lo, hi]: [number, number], ticks: number[]) {
    const span = hi - lo
    return ticks.every(v => v >= lo + span * 0.1 - 1e-9 && v <= hi - span * 0.1 + 1e-9)
  }

  it('spans the domain rather than bunching at one end', () => {
    const domain: [number, number] = [140, 200]
    const ticks = inlineTicks(domain)
    expect(ticks).toHaveLength(2)
    // The whole point of the change: the pair has to straddle the middle, or
    // it says nothing about how far the plot reaches.
    expect(ticks[0]).toBeLessThan(170)
    expect(ticks[1]).toBeGreaterThan(170)
    expect(insideBand(domain, ticks)).toBe(true)
  })

  it('keeps both values clear of the edges', () => {
    for (const domain of [[0, 100], [140, 200], [2, 10], [-40, 40], [0, 3.6]] as [number, number][]) {
      const ticks = inlineTicks(domain)
      expect(insideBand(domain, ticks)).toBe(true)
    }
  })

  it('lands on values a person would have chosen', () => {
    // 1/2/5 steps, so a heart-rate plot reads 160 and 180, never 157.3.
    expect(inlineTicks([140, 200])).toEqual([160, 180])
    expect(inlineTicks([0, 100])).toEqual([25, 75])
  })

  it('does not accumulate binary error in the labels', () => {
    // k * step is floating point, and "0.30000000000000004" is a label nobody
    // wants to read off a chart.
    for (const v of inlineTicks([0, 1])) {
      expect(String(v).length).toBeLessThan(8)
    }
  })

  it('falls back to a finer step when the coarse one steps over the band', () => {
    const domain: [number, number] = [99, 104]
    const ticks = inlineTicks(domain)
    expect(ticks.length).toBeGreaterThanOrEqual(1)
    expect(insideBand(domain, ticks)).toBe(true)
  })

  it('returns nothing for a domain with no range', () => {
    // A flat series has no range to report, and one gridline on top of the
    // line itself would be worse than none.
    expect(inlineTicks([50, 50])).toEqual([])
    expect(inlineTicks([50, 40])).toEqual([])
    expect(inlineTicks([NaN, 10])).toEqual([])
  })
})
