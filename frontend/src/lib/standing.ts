import { fmtDist, fmtDuration, type Workout } from '../data/workouts'

/**
 * Where one workout sits among the ones like it.
 *
 * This exists for the workouts with nothing to draw. A treadmill run, a pool
 * swim and a strength session are complete records that carry no route, often
 * no heart rate, and sometimes nothing but a duration — and a page built around
 * a map has nothing to say about them. What it *can* say is the thing a
 * training log is uniquely able to say: how this one compares with the rest of
 * yours.
 *
 * Deliberately computed from the library already in memory rather than asked of
 * the server. Every fact here is a pass over the workouts the app has loaded
 * anyway, and a new endpoint for four sentences would be a poor trade.
 */

/** One fact, as a label and a value the panel can show side by side. */
export interface Standing {
  label: string
  value: string
  /** A short qualifier under the value, when the number needs one. */
  hint?: string
}

/** Days between two YYYY-MM-DD keys, positive when `later` is later. */
function daysBetween(earlier: string, later: string): number {
  const a = Date.parse(`${earlier}T00:00:00`)
  const b = Date.parse(`${later}T00:00:00`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.round((b - a) / 86_400_000)
}

function ordinal(n: number): string {
  // 11th, 12th and 13th break the pattern the other teens follow.
  const teen = n % 100
  if (teen >= 11 && teen <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

/**
 * The measure this workout is best described by.
 *
 * Distance when there is one, and time otherwise. A strength session ranked by
 * distance would be a list of zeroes, and a treadmill run whose distance was
 * typed in by hand is still most honestly a distance.
 */
function measureOf(w: Workout): { by: 'distance' | 'duration'; value: number } {
  return w.distance > 0
    ? { by: 'distance', value: w.distance }
    : { by: 'duration', value: w.duration }
}

/**
 * Up to four things worth saying about where this workout stands.
 *
 * Returns fewer when there is less to say, and an empty list when the library
 * holds nothing else of this type — "your 1st ever Run" is not an achievement,
 * it is a restatement of an empty list, and the panel would rather show nothing
 * than pad itself out.
 *
 * @param all every workout in the library, this one included.
 */
export function sessionStanding(all: Workout[], w: Workout, now = new Date()): Standing[] {
  const sameType = all.filter(o => o.type === w.type)
  const others = sameType.filter(o => o.id !== w.id)
  if (others.length === 0) return []

  const out: Standing[] = []
  const { by, value } = measureOf(w)

  // Rank among the same sport, counting only workouts that have the measure at
  // all: being "4th longest" against three sessions that recorded no distance
  // says nothing about this one.
  const comparable = sameType.filter(o => (by === 'distance' ? o.distance : o.duration) > 0)
  if (value > 0 && comparable.length > 1) {
    const bigger = comparable.filter(o => (by === 'distance' ? o.distance : o.duration) > value).length
    const rank = bigger + 1
    out.push({
      label: by === 'distance' ? `Longest ${w.type}` : `Longest ${w.type} session`,
      value: rank === 1 ? 'Your longest' : `${ordinal(rank)} longest`,
      hint: `of ${comparable.length}`,
    })
  }

  // How long since the last one of this sport. Counted against the previous
  // workout rather than against today, so an old workout opened months later
  // still describes the gap that existed when it happened.
  const earlier = others.filter(o => o.date <= w.date).sort((a, b) => b.date.localeCompare(a.date))[0]
  if (earlier) {
    const gap = daysBetween(earlier.date, w.date)
    out.push({
      label: `Since your last ${w.type}`,
      value: gap === 0 ? 'Same day' : gap === 1 ? '1 day' : `${gap} days`,
    })
  }

  // How much of this sport in the four weeks up to and including it — the
  // window a training block is actually felt over.
  const from = new Date(`${w.date}T00:00:00`)
  from.setDate(from.getDate() - 27)
  const fromKey = from.toISOString().slice(0, 10)
  const recent = sameType.filter(o => o.date >= fromKey && o.date <= w.date)
  if (recent.length > 1) {
    const total = recent.reduce((sum, o) => sum + (by === 'distance' ? o.distance : o.duration), 0)
    out.push({
      label: `${w.type} in 4 weeks`,
      value: `${recent.length} session${recent.length === 1 ? '' : 's'}`,
      hint: by === 'distance' ? fmtDist(total) : fmtDuration(total),
    })
  }

  // Only for a workout recent enough for the answer to be about now. On a
  // two-year-old import "you have done 3 this month" is about a month nobody
  // is thinking about.
  const today = now.toISOString().slice(0, 10)
  if (daysBetween(w.date, today) <= 7) {
    const monthKey = w.date.slice(0, 7)
    const thisMonth = sameType.filter(o => o.date.slice(0, 7) === monthKey)
    if (thisMonth.length > 1) {
      out.push({
        label: 'This month',
        value: `${thisMonth.length} ${w.type}${thisMonth.length === 1 ? '' : 's'}`,
      })
    }
  }

  return out.slice(0, 4)
}
