import { type Weather, type Workout, type WorkoutType } from '../data/workouts'

/**
 * Reading and reasoning about workout weather.
 *
 * Pure functions, deliberately: "was I slower when it was hot" is a question
 * with a wrong answer that looks exactly like a right one — a plausible line on
 * a plausible chart — so the arithmetic belongs somewhere it can be tested
 * rather than inside a component.
 */

/**
 * WMO weather codes, grouped to what a person would say.
 *
 * Not the full table: the codes distinguish "slight" from "moderate" freezing
 * drizzle, which nobody needs to read off a workout. Grouping keeps the label
 * short and the icon meaningful.
 */
export function weatherLabel(code: number): string {
  if (code === 0) return 'Clear'
  if (code <= 2) return 'Partly cloudy'
  if (code === 3) return 'Overcast'
  if (code <= 48) return 'Fog'
  if (code <= 57) return 'Drizzle'
  if (code <= 67) return 'Rain'
  if (code <= 77) return 'Snow'
  if (code <= 82) return 'Showers'
  if (code <= 86) return 'Snow showers'
  return 'Thunderstorm'
}

/** A one-line summary for the workout page. */
export function describeWeather(w: Weather): string {
  const parts = [`${Math.round(w.tempC)}°C`]
  // Only when it disagrees with the air temperature by enough to be worth
  // saying — "12°, feels 12°" is noise.
  if (Math.abs(w.apparentC - w.tempC) >= 2) parts.push(`feels ${Math.round(w.apparentC)}°`)
  if (w.humidity > 0) parts.push(`${Math.round(w.humidity)}%`)
  if (w.windKph >= 1) parts.push(`${Math.round(w.windKph)} km/h`)
  if (w.precipMm >= 0.1) parts.push(`${w.precipMm.toFixed(1)} mm`)
  return parts.join(' · ')
}

/** Which metric the correlation is drawn against. */
export type WeatherMetric = 'pace' | 'hr'

/** One temperature bucket's worth of workouts. */
export interface TempBin {
  /** Lower bound of the bucket, °C. */
  from: number
  to: number
  /** Mean seconds per km across the bucket. */
  pace: number
  /** Mean average heart rate across the bucket. */
  hr: number
  /** How many workouts landed here. Always shown: four workouts is not a trend. */
  count: number
}

/** Width of a temperature bucket, °C. */
const BIN_C = 5

/**
 * The smallest bucket worth drawing.
 *
 * A bucket of one is that workout, not an average, and plotting it on the same
 * line as a bucket of forty invites reading a single bad run as a law about
 * temperature. Dropping them loses information; keeping them invents it.
 */
const MIN_BIN_COUNT = 3

/** Whether a workout can contribute to the correlation at all. */
export function hasUsableWeather(w: Workout, metric: WeatherMetric): boolean {
  if (!w.weather) return false
  return metric === 'pace' ? w.avgPace > 0 : w.avgHR > 0
}

/**
 * Groups workouts into temperature buckets and averages each one.
 *
 * Restricted to a single activity type by the caller, and that is not optional:
 * a Run and a Ride have pace in the same units and nothing else in common, so
 * mixing them produces a chart whose shape is the ratio of rides to runs at
 * each temperature rather than anything about temperature.
 */
export function binByTemperature(workouts: Workout[], metric: WeatherMetric): TempBin[] {
  const buckets = new Map<number, { pace: number; hr: number; count: number }>()
  for (const w of workouts) {
    if (!hasUsableWeather(w, metric)) continue
    const from = Math.floor(w.weather!.tempC / BIN_C) * BIN_C
    const acc = buckets.get(from) ?? { pace: 0, hr: 0, count: 0 }
    acc.pace += w.avgPace
    acc.hr += w.avgHR
    acc.count++
    buckets.set(from, acc)
  }
  return [...buckets.entries()]
    .filter(([, acc]) => acc.count >= MIN_BIN_COUNT)
    .map(([from, acc]) => ({
      from,
      to: from + BIN_C,
      pace: acc.pace / acc.count,
      hr: acc.hr / acc.count,
      count: acc.count,
    }))
    .sort((a, b) => a.from - b.from)
}

/**
 * Pearson correlation coefficient, or null when there is not enough to say.
 *
 * Returns null rather than 0 for a degenerate input. Zero means "measured, and
 * unrelated", which is a real finding; an empty set has no finding at all, and
 * rendering one as the other is the whole failure mode this view has.
 */
export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length)
  if (n < 3) return null
  let sx = 0, sy = 0
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i] }
  const mx = sx / n, my = sy / n
  let num = 0, dx = 0, dy = 0
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my
    num += a * b
    dx += a * a
    dy += b * b
  }
  // No spread on either axis: every workout at the same temperature, or every
  // one at the same pace. Undefined, not zero.
  if (dx === 0 || dy === 0) return null
  return num / Math.sqrt(dx * dy)
}

/** The correlation between temperature and a metric, over usable workouts. */
export function temperatureCorrelation(workouts: Workout[], metric: WeatherMetric): number | null {
  const xs: number[] = []
  const ys: number[] = []
  for (const w of workouts) {
    if (!hasUsableWeather(w, metric)) continue
    xs.push(w.weather!.tempC)
    ys.push(metric === 'pace' ? w.avgPace : w.avgHR)
  }
  return pearson(xs, ys)
}

/**
 * Plain-language reading of a correlation.
 *
 * Deliberately hedged. This is observational data over uncontrolled workouts —
 * distance, terrain, sleep and training phase all move with the seasons too —
 * so the honest summary names a tendency, never a cause.
 */
export function describeCorrelation(r: number | null, metric: WeatherMetric): string {
  if (r === null) return 'Not enough workouts with weather yet to say.'
  const strength = Math.abs(r)
  if (strength < 0.2) return 'No clear relationship in your data.'
  const how = strength < 0.4 ? 'a slight' : strength < 0.6 ? 'a moderate' : 'a strong'
  // Higher pace is *slower* — it is seconds per km — so the sign reads the
  // opposite way round from heart rate. Getting this backwards would state the
  // exact opposite of the finding, confidently.
  if (metric === 'pace') {
    return r > 0
      ? `There is ${how} tendency to run slower as it gets warmer.`
      : `There is ${how} tendency to run faster as it gets warmer.`
  }
  return r > 0
    ? `There is ${how} tendency for heart rate to rise as it gets warmer.`
    : `There is ${how} tendency for heart rate to fall as it gets warmer.`
}

/** Activity types worth offering: the ones where pace and HR mean something. */
export const CORRELATABLE_TYPES: WorkoutType[] = ['Run', 'Ride', 'Hike', 'Swim']
