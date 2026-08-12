/**
 * Two round values inside a domain, for the gridlines a phone draws in place of
 * a y axis.
 *
 * Two, not five: they exist to give the plot a sense of scale, not to be read
 * off. The axis they replace was taking about 44px of a 360px screen to say
 * five numbers nobody was measuring against.
 *
 * Rounded to a 1/2/5 step so they land on values a person would have chosen —
 * 140 and 160, not 137.4 and 158.2.
 *
 * The two returned are the *lowest and highest* round values that fit, not the
 * first two found. Taking the first two put both near the floor on a series
 * whose range needed three steps, so the plot looked like it topped out where
 * the upper label was. Low and high together say what the drawing spans, which
 * is the whole job of a tick nobody measures against.
 *
 * Both are held a tenth of the range clear of the domain's edges: a line drawn
 * on the boundary sits under the plot's own edge and its label is half outside
 * the drawing. When the range is too narrow for two, one is better than none,
 * and a flat series gets neither — correctly, since it has no range to report.
 */
export function inlineTicks([lo, hi]: [number, number]): number[] {
  const span = hi - lo
  if (!Number.isFinite(span) || span <= 0) return []
  // A tenth in from each end, which is also roughly where a label stops
  // colliding with the axis line and the plot's top edge.
  const floor = lo + span * 0.1
  const ceil = hi - span * 0.1

  // Quarter of the span, so a domain worth three or four steps offers a real
  // choice of values rather than exactly one in the middle.
  const raw = span / 4
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const coarse = [1, 2, 5, 10].map(m => m * magnitude).find(s => s >= raw) ?? magnitude * 10

  // The finer step is the fallback for a domain the coarse one steps straight
  // over — a narrow range where every round value lands outside the band.
  for (const step of [coarse, coarse / 2]) {
    const fits: number[] = []
    for (let k = Math.ceil(floor / step); k * step <= ceil; k++) {
      // Through toPrecision because k * step accumulates binary error, and
      // "0.30000000000000004" is a label nobody wants to read.
      fits.push(Number((k * step).toPrecision(12)))
    }
    if (fits.length >= 2) return [fits[0], fits[fits.length - 1]]
    if (fits.length === 1 && step === coarse / 2) return fits
  }
  return []
}
