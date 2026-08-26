import { AXIS_TICK } from '../lib/chartColors'
import { useIsMobile } from '../lib/useIsMobile'

/**
 * Props for a dense category axis — dates, weeks, months — where the number of
 * labels that fit depends on both the chart's width and the length of the text.
 *
 * `preserveStartEnd` is doing the real work. Recharts measures every label,
 * keeps the first and last, nudges those two inward so they cannot be clipped
 * by the edge of the plot, and then drops any remaining label that would
 * collide — crucially, measuring against the *nudged* position of the end
 * labels rather than their original centres.
 *
 * The bug this replaced was a fixed numeric interval ("show every nth label").
 * A numeric interval makes Recharts skip text measurement entirely, so the same
 * ~8 labels were placed whatever the width, and the end labels were shifted
 * inward by a custom tick component with nothing re-checking the neighbour they
 * had just been pushed into. Hence overlap at the two ends and nowhere else.
 */
/**
 * Room at both ends of a point or line axis, so the first and last points are
 * not sitting on the edge of the plot. Exported for the charts that build their
 * axis by hand rather than through denseXAxis — see the reasoning there.
 */
export const END_PADDING = { left: 10, right: 10 } as const

export function denseXAxis(fontSize = 10, { bars = false } = {}) {
  return {
    /*
     * Room at both ends, so the first and last points are not sitting on the
     * edge of the plot.
     *
     * Recharts only raises a tooltip for pointer positions inside the plot
     * area, and with no padding the end points land exactly on its boundary —
     * so the outer half of each has no hover target, and a pointer a few pixels
     * beyond them gets nothing at all. On a phone, where the target is a
     * fingertip rather than a cursor, that is most of the point.
     *
     * Bar charts opt out: their band scale already centres each bar in a slot
     * with space either side, and padding on top of that only shifts them out
     * of line with the gridlines.
     */
    ...(bars ? {} : { padding: END_PADDING }),
    interval: 'preserveStartEnd' as const,
    // Recharts measures label widths with the axis font *size* but the page's
    // default font family, and our ticks are monospaced — so a real label comes
    // out a few px wider than measured. This gap absorbs the difference.
    minTickGap: 14,
    // Must be on the axis itself, not only on `tick`: Recharts reads the
    // computed font-size off the axis layer to do that measurement, and would
    // otherwise measure at the inherited body size and drop far too many.
    fontSize,
    tick: { ...AXIS_TICK, fontSize },
    axisLine: false as const,
    tickLine: false as const,
  }
}

/**
 * A y axis measuring a count of things, which cannot be fractional.
 *
 * Recharts allows decimals by default, and picks its ticks from the data range,
 * so a chart topping out at two activities was labelled 0, 0.5, 1, 1.5, 2 — and
 * half an activity is not a quantity anyone has ever done. It only shows up on
 * the small ranges, which is exactly where a new account lives.
 */
export const WHOLE_NUMBERS = { allowDecimals: false } as const

/**
 * Horizontal room for the plot itself.
 *
 * A phone has ~360px to spend and the axis furniture was taking 76px of it, so
 * on the narrow layout the outer gutters shrink.
 *
 * The y axis is not sized here — give it `width="auto"` and Recharts measures
 * the widest tick label and the rotated axis label for real, then leaves a gap
 * between them. A hand-picked width cannot do that: it has to be guessed
 * against the longest tick text a chart might produce, so it is either wasteful
 * for "0–160" or too tight for "5:40".
 */
export function useChartSpace() {
  const mobile = useIsMobile()
  return {
    /** Plot margins. `bottom` leaves room for the tick row plus the axis label. */
    margin: (bottom = 18, top = 8) => ({
      top,
      right: mobile ? 6 : 16,
      left: mobile ? 0 : 8,
      bottom,
    }),
  }
}
