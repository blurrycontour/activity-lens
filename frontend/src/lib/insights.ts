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

export interface Goal {
  /** Stable key for the settings editor; not meaningful to the logic. */
  id: string
  /** Qualifying activities required per period. */
  count: number
  period: GoalPeriod
  /** Activity type that counts, or '' for any. */
  type: WorkoutType | ''
  /** Minimum distance in km for an activity to count; 0 for no minimum. */
  minKm: number
}

export function newGoal(): Goal {
  return { id: Math.random().toString(36).slice(2, 10), count: 2, period: 'week', type: '', minKm: 0 }
}

/** Human-readable summary, e.g. "2 runs a week, at least 5 km each". */
export function describeGoal(g: Goal): string {
  const noun = g.type ? `${g.type.toLowerCase()}${g.count === 1 ? '' : 's'}` : g.count === 1 ? 'activity' : 'activities'
  const min = g.minKm > 0 ? `, at least ${g.minKm} km each` : ''
  return `${g.count} ${noun} a ${g.period}${min}`
}

/** The period key a date belongs to, matching the goal's period. */
export function periodKeyOf(date: string, period: GoalPeriod): string {
  return period === 'month' ? date.slice(0, 7) : weekStartKey(date)
}

/** The last `count` period keys, oldest first, ending with the current one. */
export function recentPeriodKeys(count: number, period: GoalPeriod, now = new Date()): string[] {
  if (period === 'week') return recentWeekStarts(count, now)
  const cursor = new Date(now)
  cursor.setHours(0, 0, 0, 0)
  // Anchor to the 1st: stepping back a month from the 31st skips short months.
  cursor.setDate(1)
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    out.unshift(toDateKey(cursor).slice(0, 7))
    cursor.setMonth(cursor.getMonth() - 1)
  }
  return out
}

export interface GoalProgress {
  goal: Goal
  /** Qualifying activities in the current period. */
  current: number
  /** Consecutive completed periods meeting the goal. */
  streak: number
  /** Longest run of goal-meeting periods ever recorded. */
  bestStreak: number
  /** Recent periods, oldest first, with whether each met the goal. */
  history: { key: string; count: number; met: boolean }[]
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
  return true
}

/**
 * Progress against one goal. The period in progress is reported separately and
 * excluded from the streak until it is actually met — a Monday shouldn't break
 * a streak that four completed weeks earned.
 */
export function goalProgress(workouts: Workout[], goal: Goal, historyLength = 8, now = new Date()): GoalProgress {
  const perPeriod = new Map<string, number>()
  for (const w of workouts) {
    if (!countsToward(w, goal)) continue
    const key = periodKeyOf(w.date, goal.period)
    perPeriod.set(key, (perPeriod.get(key) ?? 0) + 1)
  }
  const currentKey = recentPeriodKeys(1, goal.period, now)[0]
  const current = perPeriod.get(currentKey) ?? 0

  const history = recentPeriodKeys(historyLength, goal.period, now).map(key => {
    const count = perPeriod.get(key) ?? 0
    return { key, count, met: goal.count > 0 && count >= goal.count }
  })

  let streak = 0
  if (goal.count > 0) {
    // Walk back from the current period. The one in progress extends a streak
    // once met but never ends one.
    if (current >= goal.count) streak++
    const cursor = new Date(goal.period === 'month' ? `${currentKey}-01T00:00:00` : `${currentKey}T00:00:00`)
    for (;;) {
      if (goal.period === 'month') cursor.setMonth(cursor.getMonth() - 1)
      else cursor.setDate(cursor.getDate() - 7)
      const key = periodKeyOf(toDateKey(cursor), goal.period)
      if ((perPeriod.get(key) ?? 0) < goal.count) break
      streak++
    }
  }

  let bestStreak = 0
  if (goal.count > 0 && perPeriod.size > 0) {
    const met = [...perPeriod.entries()].filter(([, c]) => c >= goal.count).map(([k]) => k).sort()
    let run = 0
    let prev: string | null = null
    for (const key of met) {
      run = prev != null && isNextPeriod(prev, key, goal.period) ? run + 1 : 1
      bestStreak = Math.max(bestStreak, run)
      prev = key
    }
  }

  return { goal, current, streak, bestStreak: Math.max(bestStreak, streak), history }
}

/** Whether `b` is the period immediately after `a`. */
function isNextPeriod(a: string, b: string, period: GoalPeriod): boolean {
  if (period === 'week') {
    return new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime() === 7 * 86400000
  }
  const [ay, am] = a.split('-').map(Number)
  const next = am === 12 ? `${ay + 1}-01` : `${ay}-${String(am + 1).padStart(2, '0')}`
  return b === next
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
