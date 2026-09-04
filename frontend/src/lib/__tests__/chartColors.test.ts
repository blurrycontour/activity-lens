import { describe, expect, it } from 'vitest'
import { rampFrom } from '../chartColors'

/**
 * The ramp is what makes an ordered chart readable, and it fails silently: a
 * bad one is not an error, it is three bars nobody can tell apart. So the two
 * properties it exists for are asserted rather than eyeballed.
 *
 * Lightness is the measure, deliberately. The failure this replaced —
 * #00e87a, #1cc97c, #32b17d — differed plenty in chroma and barely at all in
 * lightness, which is the one the eye separates first.
 */

/** Rec. 709 lightness of an `rgb(r, g, b)` string, 0–255. */
function lightness(color: string): number {
  const [r, g, b] = color.match(/\d+/g)!.map(Number)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// The theme tokens, from index.css.
const DARK = ['#e8eaed', '#9ca3af', '#6b7280']
const LIGHT = ['#0f1117', '#374151', '#9ca3af']

// The six accents a user can pick, from lib/theme.ts.
const ACCENTS = ['#00e87a', '#3b82f6', '#f3d124', '#a855f7', '#06b6d4', '#f9386f']

describe('rampFrom', () => {
  it('returns the accent alone for a single series', () => {
    expect(rampFrom('#00e87a', DARK, 1)).toEqual(['#00e87a'])
  })

  it('steps monotonically in lightness, for every accent and both themes', () => {
    for (const inks of [DARK, LIGHT]) {
      for (const accent of ACCENTS) {
        for (const n of [2, 3, 5]) {
          const steps = rampFrom(accent, inks, n).map(lightness)
          const rising = steps[steps.length - 1] > steps[0]
          for (let i = 1; i < steps.length; i++) {
            const moved = rising ? steps[i] - steps[i - 1] : steps[i - 1] - steps[i]
            expect(moved, `${accent} n=${n} step ${i}`).toBeGreaterThan(0)
          }
        }
      }
    }
  })

  /**
   * The regression itself: both of these fail against the implementation this
   * replaced, which always ended on --text-3 and approached it asymptotically.
   *
   * Of the two changes it is the endpoint that carries this — ending on a grey
   * no lighter than the accent leaves the steps nowhere to move, and no amount
   * of respacing rescues a range that short. The even spacing is what keeps the
   * tail from crowding once there are five of them.
   */
  it('separates adjacent steps by a usable margin at three series', () => {
    for (const inks of [DARK, LIGHT]) {
      for (const accent of ACCENTS) {
        const steps = rampFrom(accent, inks, 3).map(lightness)
        for (let i = 1; i < steps.length; i++) {
          expect(Math.abs(steps[i] - steps[i - 1]), `${accent} step ${i}`).toBeGreaterThan(12)
        }
      }
    }
  })
})
