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

/**
 * The same room, on a y axis.
 *
 * A scatter needs it on both axes for the same reason a line needs it on one:
 * a point at the extreme of the data lands on the plot boundary, and Recharts
 * only resolves a tooltip for pointer positions *inside* that boundary. On the
 * weather chart the two dots at the ends of the range were unreachable, which
 * read as "tooltips only work for some sports" because which sport owned the
 * extremes depended on the data.
 */
export const EDGE_PADDING_Y = { top: 12, bottom: 12 } as const

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
 * A *numeric* date axis — one whose positions are timestamps rather than slots.
 *
 * denseXAxis is for a category axis, where Recharts measures each label and
 * drops the ones that would collide. A numeric axis picks its own tick values
 * instead, and `preserveStartEnd` has nothing to preserve: with a handful of
 * activities it chose near-identical timestamps and drew "Jul 30Jul 30" on top
 * of itself. A tick count and a real gap are what that axis wants.
 *
 * Four is deliberate. It is enough to read a month at phone width and few
 * enough that the labels cannot meet, whatever the range or the formatter.
 */
export function timeXAxis(fontSize = 10) {
  return {
    // The caller passes explicit `ticks`; this is the floor that keeps two of
    // them from touching if it ever does not.
    minTickGap: 24,
    fontSize,
    tick: { ...AXIS_TICK, fontSize },
    axisLine: false as const,
    tickLine: false as const,
  }
}

/**
 * A y axis measuring a count of things/**
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
/** Axis label placed below the plot, clear of the tick row. */
export function xLabel(value: string) {
  return { value, position: 'insideBottom' as const, offset: -12, fontSize: 10, fill: 'var(--text-3)' }
}

export function useChartSpace() {
  const mobile = useIsMobile()
  return {
    /*
     * The rotated y-axis label — and nothing at all on a phone.
     *
     * Rotated -90°, the label's length runs along the plot's height and its
     * 12px line box hangs off the left edge, one pixel outside the SVG on a
     * 390px screen: "Adjusted pace (min/km)" rendered as "usted pace (min/km)".
     *
     * Widening the gutter would fix the clipping and cost the plot the width,
     * which is the scarcer thing here — and on a phone the label is saying what
     * the card's title and description said two lines above it. Dropping it
     * buys back the space instead, and takes the same pixels out of the dead
     * strip to the left of the plot where a tap raises no tooltip.
     */
    yLabel: (value: string) => (mobile ? undefined : {
      value, angle: -90, position: 'insideLeft' as const,
      fontSize: 10, fill: 'var(--text-3)', style: { textAnchor: 'middle' as const },
    }),
    /** Plot margins. `bottom` leaves room for the tick row plus the axis label. */
    margin: (bottom = 18, top = 8) => ({
      top,
      right: mobile ? 6 : 16,
      left: mobile ? 0 : 8,
      bottom,
    }),
  }
}
