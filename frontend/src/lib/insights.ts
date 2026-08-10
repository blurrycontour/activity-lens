// Derived dashboard insights: streaks against a weekly goal, period-on-period
// deltas, personal bests, gear wear and training load. Kept out of the page
// component so each rule can be read (and reasoned about) on its own.

import type { Workout, WorkoutType } from '../data/workouts'
import { toDateKey } from './range'

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Local Date at midnight for a YYYY-MM-DD key, free of timezone drift. */
export function parseDateKey(date: string): Date {
  return new Date(`${date}T00:00:00`)
}

/** Monday-anchored week key (YYYY-MM-DD) for a date key. */
export function weekStartKey(date: string): string {
  const d = parseDateKey(date)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return toDateKey(d)
}

/** Monday index (0 = Mon … 6 = Sun) for a date key. */
export function weekdayIndex(date: string): number {
  return (parseDateKey(date).getDay() + 6) % 7
}

/** The Monday keys of the last `count` weeks, oldest first, including this one. */
export function recentWeekStarts(count: number, now = new Date()): string[] {
  const cursor = new Date(now)
  cursor.setHours(0, 0, 0, 0)
  cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7))
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    out.unshift(toDateKey(cursor))
    cursor.setDate(cursor.getDate() - 7)
  }
  return out
}

/**
 * Weekday × week matrix for the "week over week" comparison: one row per
 * weekday, one numeric field per week key. Mirrors the year-over-year chart,
 * where the x axis is a position within the cycle and each series is one cycle.
 */
export function weekdayMatrix(
  workouts: Workout[],
  weekKeys: string[],
  valueOf: (w: Workout) => number,
): Record<string, string | number>[] {
  const totals = new Map<string, number[]>()
  for (const key of weekKeys) totals.set(key, Array(7).fill(0))
  for (const w of workouts) {
    const row = totals.get(weekStartKey(w.date))
    if (row) row[weekdayIndex(w.date)] += valueOf(w)
  }
  return WEEKDAYS.map((day, i) => {
    const row: Record<string, string | number> = { day }
    for (const key of weekKeys) row[key] = totals.get(key)![i]
    return row
  })
}

// ── Goals & streaks ─────────────────────────────────────────────────────────

export type GoalPeriod = 'week' | 'month'

/**
 * What a goal measures. A goal targets exactly one of these — wanting both a
 * count and a distance is two goals, which keeps every tile a single number
 * against a single target.
 */
export type GoalMetric = 'count' | 'distance' | 'duration'

export interface Goal {
  /** Stable key for the settings editor; not meaningful to the logic. */
  id: string
  metric: GoalMetric
  /** The number to reach, in the metric's unit: activities, km, or hours. */
  target: number
  period: GoalPeriod
  /** How many periods one window covers; 1 for a plain week or month. */
  span: number
  /** Activity type that counts, or '' for any. */
  type: WorkoutType | ''
  /**
   * Qualifiers on each activity, not on the total: one below either is ignored
   * entirely. 0 for no minimum.
   */
  minKm: number
  minMinutes: number
}

/** Cap on how many periods one window may cover, mirroring the server's. */
export const MAX_GOAL_SPAN = 12

export function newGoal(): Goal {
  return { id: Math.random().toString(36).slice(2, 10), metric: 'count', target: 2, period: 'week', span: 1, type: '', minKm: 0, minMinutes: 0 }
}

/**
 * Normalizes a goal as the API hands it over into the shape the logic below
 * relies on. Both the dashboard and the settings editor read the same endpoint,
 * and a goal saved by an older client is missing the newer fields entirely.
 */
export function goalFromApi(g: Partial<Record<keyof Goal, unknown>>): Goal {
  const metric = g.metric === 'distance' || g.metric === 'duration' ? g.metric : 'count'
  const span = Math.min(MAX_GOAL_SPAN, Math.max(1, Math.round(Number(g.span) || 1)))
  return {
    id: typeof g.id === 'string' && g.id ? g.id : Math.random().toString(36).slice(2, 10),
    metric,
    target: Math.max(0, Number(g.target) || 0),
    period: g.period === 'month' ? 'month' : 'week',
    span,
    type: (g.type as WorkoutType | '') ?? '',
    minKm: Math.max(0, Number(g.minKm) || 0),
    minMinutes: Math.max(0, Number(g.minMinutes) || 0),
  }
}

/** The short unit shown after a goal's numbers; counts carry none. */
export function goalUnit(metric: GoalMetric): string {
  return metric === 'distance' ? 'km' : metric === 'duration' ? 'h' : ''
}

/**
 * A value in the goal's unit: counts whole, km and hours to one decimal.
 * `bare` drops the unit, for the left half of a "12.4/40 km" pair.
 */
export function formatGoalAmount(g: Pick<Goal, 'metric'>, value: number, bare = false): string {
  if (g.metric === 'count') return String(Math.round(value))
  const n = Math.round(value * 10) / 10
  return bare ? String(n) : `${n} ${goalUnit(g.metric)}`
}

/** How long one window is, in words: "a week", "every 3 weeks". */
export function describeGoalWindow(g: Goal): string {
  return g.span > 1 ? `every ${g.span} ${g.period}s` : `a ${g.period}`
}

/**
 * Human-readable summary, e.g. "2 runs a week" or "Hike 40 km a month".
 *
 * Distance and time goals lead with the sport as a verb rather than folding it
 * into a noun phrase: "40 km of hike" would need a gerund per activity type to
 * read as English, and the backend renders the same sentence for notifications.
 */
export function describeGoal(g: Goal): string {
  const window = describeGoalWindow(g)
  const min = describeGoalMinimum(g)
  if (g.metric !== 'count') {
    const lead = g.type ? `${g.type} ` : ''
    return `${lead}${formatGoalAmount(g, g.target)} ${window}${min}`
  }
  const sport = g.type ? g.type.toLowerCase() : 'activity'
  const n = Math.round(g.target)
  const noun = n === 1 ? sport : g.type ? `${sport}s` : 'activities'
  return `${n} ${noun} ${window}${min}`
}

/** The per-activity qualifiers as a trailing clause, or '' when there are none. */
function describeGoalMinimum(g: Goal): string {
  const parts: string[] = []
  if (g.minKm > 0) parts.push(`${g.minKm} km`)
  if (g.minMinutes > 0) parts.push(`${g.minMinutes} min`)
  return parts.length === 0 ? '' : ` (${parts.join(', ')}+ only)`
}

/**
 * ISO-8601 week number for a date key.
 *
 * The ISO rule — the week containing the year's first Thursday is week 1 — is
 * the one that matches Monday-anchored weeks, which is what goals count in. A
 * naive "days since January 1, divided by seven" disagrees with it for the first
 * and last days of most years.
 */
export function isoWeekNumber(date: string): number {
  const d = parseDateKey(date)
  // Shift to the Thursday of this week; the week's year and number are then
  // whatever that Thursday's are.
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const firstThursday = new Date(d.getFullYear(), 0, 4)
  firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7))
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86400000))
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * The short label under a history bar: "W31" for a week, "Jul" for a month.
 *
 * A window spanning several periods is named by the one it starts in, since
 * that is what its key is, and the tooltip carries the exact date either way.
 */
export function periodLabel(key: string, period: GoalPeriod): string {
  if (period === 'month') return MONTH_NAMES[Number(key.slice(5, 7)) - 1] ?? key
  return `W${isoWeekNumber(key)}`
}

/** Whole days since the Unix epoch, immune to DST because it goes via UTC. */
function epochDays(d: Date): number {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000)
}

/**
 * `a % n`, never negative — windows have to tile consistently on either side of
 * the anchor, and JS's `%` keeps the sign of the dividend.
 */
function floorMod(a: number, n: number): number {
  return ((a % n) + n) % n
}

/**
 * The key of the window a date belongs to.
 *
 * For a span of one this is the Monday of the week or the YYYY-MM of the month.
 * Longer windows tile forward from a fixed anchor — 1970-01-05, a Monday, for
 * weeks and January for months — rather than from today, so the window a
 * workout falls into does not shift from one day to the next and a streak of
 * consecutive windows stays meaningful.
 */
export function periodKeyOf(date: string, g: Pick<Goal, 'period' | 'span'>): string {
  const span = Math.max(1, Math.round(g.span || 1))
  if (g.period === 'month') {
    const [y, m] = date.split('-').map(Number)
    const index = y * 12 + (m - 1)
    const start = index - floorMod(index, span)
    return `${String(Math.floor(start / 12)).padStart(4, '0')}-${String((start % 12) + 1).padStart(2, '0')}`
  }
  const monday = weekStartKey(date)
  if (span === 1) return monday
  // 4 is the epoch-day number of Monday 1970-01-05.
  const weeks = Math.floor((epochDays(parseDateKey(monday)) - 4) / 7)
  const back = floorMod(weeks, span)
  const start = parseDateKey(monday)
  start.setDate(start.getDate() - 7 * back)
  return toDateKey(start)
}

/** The last `count` window keys for a goal, oldest first, ending with the current one. */
export function recentPeriodKeys(count: number, g: Pick<Goal, 'period' | 'span'>, now = new Date()): string[] {
  const span = Math.max(1, Math.round(g.span || 1))
  const cursor = new Date(now)
  cursor.setHours(0, 0, 0, 0)
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    out.unshift(periodKeyOf(toDateKey(cursor), g))
    // Step back one whole window. Months anchor to the 1st first, or stepping
    // back from the 31st would skip the short months in between.
    if (g.period === 'month') {
      cursor.setDate(1)
      cursor.setMonth(cursor.getMonth() - span)
    } else {
      cursor.setDate(cursor.getDate() - 7 * span)
    }
  }
  return out
}

/** The first instant of a window and the first instant of the one after it. */
export function periodBounds(key: string, g: Pick<Goal, 'period' | 'span'>): [Date, Date] {
  const span = Math.max(1, Math.round(g.span || 1))
  if (g.period === 'month') {
    const start = parseDateKey(`${key}-01`)
    const end = new Date(start)
    end.setMonth(end.getMonth() + span)
    return [start, end]
  }
  const start = parseDateKey(key)
  const end = new Date(start)
  end.setDate(end.getDate() + 7 * span)
  return [start, end]
}

export interface GoalProgress {
  goal: Goal
  /** Progress in the current window, in the goal's unit. */
  current: number
  /**
   * How much of the current window has already gone, 0 to 1.
   *
   * The number the old tile never had, and the one that separates "behind" from
   * "not finished yet": 1 of 3 runs is a fine Tuesday and a poor Sunday. Only
   * the pace-aware styles read it, but it costs nothing to always compute.
   */
  elapsed: number
  /** Consecutive completed windows meeting the goal. */
  streak: number
  /** Longest run of goal-meeting windows ever recorded. */
  bestStreak: number
  /** Recent windows, oldest first, with whether each met the goal. */
  history: { key: string; value: number; met: boolean }[]
}

/**
 * Whether a workout counts toward a goal.
 *
 * The distance test compares the *displayed* distance, rounded to one decimal
 * place, rather than the raw metres. A GPS run shown everywhere in the app as
 * "5.0 km" is typically stored as something like 4,983 m, and a goal that
 * rejected it while the UI called it 5 km would simply look broken.
 */
function countsToward(w: Workout, goal: Goal): boolean {
  if (goal.type && w.type !== goal.type) return false
  if (goal.minKm > 0 && Math.round(w.distance / 100) / 10 < goal.minKm) return false
  if (goal.minMinutes > 0 && w.duration / 60 < goal.minMinutes) return false
  return true
}

/** What one qualifying workout contributes: one activity, km, or hours. */
function valueToward(w: Workout, metric: GoalMetric): number {
  if (metric === 'distance') return w.distance / 1000
  if (metric === 'duration') return w.duration / 3600
  return 1
}

/** The key of the window immediately before `key`. */
function previousPeriodKey(key: string, g: Pick<Goal, 'period' | 'span'>): string {
  const span = Math.max(1, Math.round(g.span || 1))
  const cursor = parseDateKey(g.period === 'month' ? `${key}-01` : key)
  if (g.period === 'month') cursor.setMonth(cursor.getMonth() - span)
  else cursor.setDate(cursor.getDate() - 7 * span)
  return periodKeyOf(toDateKey(cursor), g)
}

/**
 * Progress against one goal. The window in progress is reported separately and
 * excluded from the streak until it is actually met — a Monday shouldn't break
 * a streak that four completed weeks earned.
 */
export function goalProgress(workouts: Workout[], goal: Goal, historyLength = 8, now = new Date()): GoalProgress {
  const perPeriod = new Map<string, number>()
  for (const w of workouts) {
    if (!countsToward(w, goal)) continue
    const key = periodKeyOf(w.date, goal)
    perPeriod.set(key, (perPeriod.get(key) ?? 0) + valueToward(w, goal.metric))
  }
  const currentKey = periodKeyOf(toDateKey(now), goal)
  const current = perPeriod.get(currentKey) ?? 0
  const met = (value: number) => goal.target > 0 && value >= goal.target

  const history = recentPeriodKeys(historyLength, goal, now).map(key => {
    const value = perPeriod.get(key) ?? 0
    return { key, value, met: met(value) }
  })

  let streak = 0
  if (goal.target > 0) {
    // Walk back from the current window. The one in progress extends a streak
    // once met but never ends one.
    if (met(current)) streak++
    let key = currentKey
    for (;;) {
      key = previousPeriodKey(key, goal)
      if (!met(perPeriod.get(key) ?? 0)) break
      streak++
    }
  }

  let bestStreak = 0
  if (goal.target > 0 && perPeriod.size > 0) {
    const done = [...perPeriod.entries()].filter(([, v]) => met(v)).map(([k]) => k).sort()
    let run = 0
    let prev: string | null = null
    for (const key of done) {
      run = prev != null && previousPeriodKey(key, goal) === prev ? run + 1 : 1
      bestStreak = Math.max(bestStreak, run)
      prev = key
    }
  }

  const [windowStart, windowEnd] = periodBounds(currentKey, goal)
  const elapsed = Math.min(1, Math.max(0,
    (now.getTime() - windowStart.getTime()) / (windowEnd.getTime() - windowStart.getTime()),
  ))

  return { goal, current, elapsed, streak, bestStreak: Math.max(bestStreak, streak), history }
}

// ── Period-on-period deltas ──────────────────────────────────────────────────

/** Totals used by the stat cards, for one slice of time. */
export interface Totals {
  count: number
  distance: number
  duration: number
  elevation: number
  calories: number
  avgHR: number
}

export function totalsOf(workouts: Workout[]): Totals {
  const t: Totals = { count: workouts.length, distance: 0, duration: 0, elevation: 0, calories: 0, avgHR: 0 }
  let hrSum = 0
  let hrCount = 0
  for (const w of workouts) {
    t.distance += w.distance
    t.duration += w.duration
    t.elevation += w.elevationGain
    t.calories += w.calories
    if (w.avgHR > 0) { hrSum += w.avgHR; hrCount++ }
  }
  t.avgHR = hrCount > 0 ? Math.round(hrSum / hrCount) : 0
  return t
}

/**
 * Percent change from `previous` to `current`, or null when there is no
 * meaningful baseline — showing "+100%" against a zero previous period would
 * be noise rather than signal.
 */
export function deltaPct(current: number, previous: number): number | null {
  if (previous <= 0) return null
  return Math.round(((current - previous) / previous) * 100)
}

/**
 * Splits workouts into the current window and the equally long window before
 * it. Returns null for the previous slice when the window is "all time", which
 * has nothing to compare against.
 */
export function windowSlices(workouts: Workout[], windowDays: number, now = new Date()): { current: Workout[]; previous: Workout[] | null } {
  if (windowDays <= 0) return { current: workouts, previous: null }
  const startOf = (daysAgo: number) => {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - daysAgo + 1)
    return toDateKey(d)
  }
  const curStart = startOf(windowDays)
  const prevStart = startOf(windowDays * 2)
  return {
    current: workouts.filter(w => w.date >= curStart),
    previous: workouts.filter(w => w.date >= prevStart && w.date < curStart),
  }
}

/** Buckets a window into `buckets` equal slices for a sparkline. */
export function sparkBuckets(workouts: Workout[], windowDays: number, buckets: number, valueOf: (w: Workout) => number, now = new Date()): number[] {
  const days = windowDays > 0 ? windowDays : 8 * 7
  const end = new Date(now)
  end.setHours(0, 0, 0, 0)
  const start = new Date(end)
  start.setDate(start.getDate() - days + 1)
  const out = Array(buckets).fill(0)
  const span = days / buckets
  for (const w of workouts) {
    const offset = (parseDateKey(w.date).getTime() - start.getTime()) / 86400000
    if (offset < 0 || offset >= days) continue
    out[Math.min(buckets - 1, Math.floor(offset / span))] += valueOf(w)
  }
  return out
}

// ── Personal bests ───────────────────────────────────────────────────────────

export interface PersonalBest {
  workout: Workout
  /** Which record the workout set. */
  kind: 'distance' | 'pace' | 'elevation' | 'duration'
  label: string
  value: string
}

/**
 * Records set by the most recent workout, judged against every other activity
 * of the same type. Requires a few prior activities of that type — being the
 * "longest ever" out of two is not an achievement worth a banner.
 */
export function recentPersonalBests(workouts: Workout[], minSameType = 3, maxAgeDays = 14, now = new Date()): PersonalBest[] {
  if (workouts.length === 0) return []
  const sorted = [...workouts].sort((a, b) => b.date.localeCompare(a.date))
  const latest = sorted[0]
  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() - maxAgeDays)
  if (parseDateKey(latest.date) < cutoff) return []

  const peers = workouts.filter(w => w.type === latest.type && w.id !== latest.id)
  if (peers.length < minSameType) return []

  const out: PersonalBest[] = []
  if (latest.distance > 0 && peers.every(w => latest.distance > w.distance)) {
    out.push({ workout: latest, kind: 'distance', label: 'Longest ' + latest.type, value: `${(latest.distance / 1000).toFixed(1)} km` })
  }
  if (latest.duration > 0 && peers.every(w => latest.duration > w.duration)) {
    out.push({ workout: latest, kind: 'duration', label: 'Longest time', value: `${Math.floor(latest.duration / 3600)}h ${Math.round((latest.duration % 3600) / 60)}m` })
  }
  const paced = peers.filter(w => w.avgPace > 0)
  if (latest.avgPace > 0 && paced.length >= minSameType && paced.every(w => latest.avgPace < w.avgPace)) {
    const mins = Math.floor(latest.avgPace / 60)
    const secs = Math.round(latest.avgPace % 60)
    out.push({ workout: latest, kind: 'pace', label: 'Fastest pace', value: `${mins}:${String(secs).padStart(2, '0')} /km` })
  }
  if (latest.elevationGain > 100 && peers.every(w => latest.elevationGain > w.elevationGain)) {
    out.push({ workout: latest, kind: 'elevation', label: 'Most climbing', value: `${Math.round(latest.elevationGain)} m` })
  }
  return out
}

// ── Training load ────────────────────────────────────────────────────────────

/** TSS-equivalent for one workout: duration scaled by relative heart-rate effort. */
export function loadOf(w: Workout): number {
  return Math.round(w.duration / 3600 * w.avgHR / 150 * 100)
}

export interface FormReading {
  ratio: number
  acute: number
  chronic: number
  verdict: 'detraining' | 'steady' | 'building' | 'ramping'
  headline: string
  detail: string
}

/**
 * Acute (7-day) against chronic (28-day) average daily load.
 *
 * Returns null unless there is enough history for the number to mean anything:
 * the chronic average needs four full weeks behind it, and a handful of
 * activities with heart rate, or the ratio swings wildly on a single session.
 * The wording is deliberately descriptive — the injury-risk thresholds this
 * metric is famous for are contested in the literature, so the tile reports
 * what your load is doing rather than issuing a medical warning.
 */
export function formReading(workouts: Workout[], now = new Date()): FormReading | null {
  const withHR = workouts.filter(w => w.avgHR > 0 && w.duration > 0)
  if (withHR.length < 12) return null

  const oldest = workouts.reduce((a, w) => w.date < a ? w.date : a, workouts[0].date)
  const historyDays = (now.getTime() - parseDateKey(oldest).getTime()) / 86400000
  if (historyDays < 42) return null

  const byDate = new Map<string, number>()
  for (const w of withHR) byDate.set(w.date, (byDate.get(w.date) ?? 0) + loadOf(w))
  const dailyBack = (days: number) => {
    let sum = 0
    for (let i = 0; i < days; i++) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      sum += byDate.get(toDateKey(d)) ?? 0
    }
    return sum / days
  }
  const acute = dailyBack(7)
  const chronic = dailyBack(28)
  if (chronic <= 0) return null

  const ratio = Math.round((acute / chronic) * 100) / 100
  const pct = Math.round((ratio - 1) * 100)
  if (ratio < 0.8) {
    return {
      ratio, acute: Math.round(acute), chronic: Math.round(chronic), verdict: 'detraining',
      headline: 'Easing off',
      detail: `This week's load is ${Math.abs(pct)}% below your four-week average — a taper or a rest block.`,
    }
  }
  if (ratio <= 1.15) {
    return {
      ratio, acute: Math.round(acute), chronic: Math.round(chronic), verdict: 'steady',
      headline: 'Holding steady',
      detail: 'This week matches the load your body is already used to.',
    }
  }
  if (ratio <= 1.5) {
    return {
      ratio, acute: Math.round(acute), chronic: Math.round(chronic), verdict: 'building',
      headline: 'Building',
      detail: `This week's load is ${pct}% above your four-week average — a normal progression.`,
    }
  }
  return {
    ratio, acute: Math.round(acute), chronic: Math.round(chronic), verdict: 'ramping',
    headline: 'Ramping up fast',
    detail: `This week's load is ${pct}% above your four-week average. Big jumps are worth easing into.`,
  }
}

// ── Gear ─────────────────────────────────────────────────────────────────────

export interface GearNudge {
  id: string
  name: string
  km: number
  limitKm: number
  pct: number
  /** Past its replacement distance rather than merely approaching it. */
  overdue: boolean
}

/**
 * Gear approaching or past its replacement distance, most worn first.
 *
 * Only equipment with a meaningful wear limit is considered — a watch does not
 * wear out by the kilometre — and retired items are skipped, since the user has
 * already acted on them. Deterministic rather than random: the point is to
 * surface the item that actually needs attention.
 */
export function gearNudges(
  equipment: { id: string; name: string; type: string; retired: boolean; totalDistance?: number; retireAtKm?: number }[],
  defaultLimitKm: (type: string) => number,
  warnFrom = 0.8,
): GearNudge[] {
  return equipment
    .filter(e => !e.retired)
    .map(e => {
      const limitKm = e.retireAtKm && e.retireAtKm > 0 ? e.retireAtKm : defaultLimitKm(e.type)
      const km = Math.round((e.totalDistance ?? 0) / 1000)
      return { id: e.id, name: e.name, km, limitKm, pct: limitKm > 0 ? km / limitKm : 0, overdue: limitKm > 0 && km >= limitKm }
    })
    .filter(g => g.limitKm > 0 && g.pct >= warnFrom)
    .sort((a, b) => b.pct - a.pct)
}
