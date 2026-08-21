/**
 * The metrics a workout carries that the app has no page of its own for.
 *
 * A FIT file records more than the four series charted everywhere — power and
 * temperature today, whatever a watch measures next after that. Those arrive
 * from the server as named series, and this is the only place that knows what
 * a name means: what to call it, what unit it is in, and what colour to draw.
 *
 * Deliberately not part of the workout type or the analysis pages. Not every
 * workout has these, so nothing can be compared across a library on them; they
 * belong to the one page that is about a single activity, and they stay there.
 *
 * An unknown name still draws. The server can start sending a series this build
 * has never heard of, and the fallback below turns it into a readable label
 * rather than an omission nobody notices — which is what makes adding a metric
 * a one-line change on the server rather than a release on both sides.
 */

export interface ExtraSeriesMeta {
  label: string
  /** Shown after every value; empty for a bare number. */
  unit: string
  /** A theme token, never a literal — the app has six accents and three themes. */
  color: string
  /** What the chart is, in the tooltip that explains it. */
  info: string
  /** Decimal places for the stats line under the chart. */
  decimals: number
}

const KNOWN: Record<string, ExtraSeriesMeta> = {
  power: {
    label: 'Power',
    unit: 'W',
    color: 'var(--purple)',
    info: 'Mechanical power, as the meter reported it. Unlike pace or heart rate it responds instantly and is unaffected by hills, wind or how tired you are — which is why it is what structured training is built on. Only files that came from a power meter carry it.',
    decimals: 0,
  },
  temperature: {
    label: 'Temperature',
    unit: '°C',
    color: 'var(--swim)',
    info: 'Air temperature from the sensor on the device. It sits close to your body and in the sun, so it usually reads a little high — treat it as what the watch felt rather than what the weather station recorded. The Conditions card below is the outside view of the same activity.',
    decimals: 0,
  },
}

/** Human label for a series name the app does not know: `stride_length` → `Stride length`. */
function humanise(name: string): string {
  const words = name.replace(/[_-]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** What to call, and how to draw, one named series. */
export function extraSeriesMeta(name: string): ExtraSeriesMeta {
  return KNOWN[name] ?? {
    label: humanise(name),
    unit: '',
    // The accent, for anything unrecognised: it is the one colour that is
    // always defined and never means something else on a chart.
    color: 'var(--primary)',
    info: 'Recorded by the device that produced this file. Activity Lens keeps series it has no page of its own for, so nothing the file measured is lost.',
    decimals: 1,
  }
}

/** Min, average and max of a series, for the line under its chart. */
export function extraSeriesStats(points: { v: number }[]): { min: number; avg: number; max: number } | null {
  if (points.length === 0) return null
  let min = Infinity
  let max = -Infinity
  let sum = 0
  for (const p of points) {
    if (p.v < min) min = p.v
    if (p.v > max) max = p.v
    sum += p.v
  }
  return { min, avg: sum / points.length, max }
}
