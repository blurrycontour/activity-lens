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
export function denseXAxis(fontSize = 10) {
  return {
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
