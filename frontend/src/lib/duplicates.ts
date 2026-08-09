import { type Workout } from '../data/workouts'

/**
 * Finding workouts that are the same activity imported twice.
 *
 * The content hash already stops a byte-identical file being imported again, so
 * everything that reaches here got past it: the same ride exported once by the
 * watch and once by Strava, a file re-saved with a corrected name, a sync that
 * ran before and after an edit. Those differ in metadata and agree on what
 * actually happened — same sport, same day, same length, same distance — which
 * is what this matches on.
 *
 * Deliberately advisory. It selects candidates and hands them to the user;
 * nothing here deletes anything, because "these two look alike" is a guess and
 * an interval session repeated on a track is a real pair of workouts that this
 * cannot tell apart from a mistake.
 */

/** Two workouts may differ by this much in duration and still be the same one. */
const DURATION_TOLERANCE_SEC = 60
const DURATION_TOLERANCE_FRAC = 0.02

/** …and by this much in distance. */
const DISTANCE_TOLERANCE_M = 100
const DISTANCE_TOLERANCE_FRAC = 0.02

/**
 * How far apart two starts can be and still be one activity.
 *
 * Generous because the two files often disagree: a device writes the first GPS
 * fix, an app writes the moment you pressed start, and a timezone written
 * wrongly by one exporter moves it further still. Same calendar day is the
 * fallback when a start time is missing, which is every workout on a server
 * older than the field.
 */
const START_TOLERANCE_SEC = 30 * 60

function near(a: number, b: number, absolute: number, fraction: number): boolean {
  return Math.abs(a - b) <= Math.max(absolute, Math.max(a, b) * fraction)
}

function startSeconds(w: Workout): number | null {
  if (!w.startTime) return null
  const t = Date.parse(w.startTime)
  return Number.isNaN(t) ? null : t / 1000
}

/** Whether two workouts describe the same activity. */
export function looksLikeSame(a: Workout, b: Workout): boolean {
  if (a.id === b.id) return false
  if (a.type !== b.type) return false
  if (a.date !== b.date) return false

  const sa = startSeconds(a)
  const sb = startSeconds(b)
  if (sa !== null && sb !== null && Math.abs(sa - sb) > START_TOLERANCE_SEC) return false

  if (!near(a.duration, b.duration, DURATION_TOLERANCE_SEC, DURATION_TOLERANCE_FRAC)) return false

  // A strength session or a treadmill run has no distance, and two of them on
  // the same day at the same length are as alike as this can tell. Requiring a
  // distance match would silently exclude every workout without one.
  if (a.distance > 0 || b.distance > 0) {
    if (!near(a.distance, b.distance, DISTANCE_TOLERANCE_M, DISTANCE_TOLERANCE_FRAC)) return false
  }
  return true
}

/**
 * Groups of workouts that look like the same activity, newest group first.
 *
 * Grouping is transitive by construction — if A matches B and B matches C, all
 * three land together — which is right for the case this exists for: three
 * copies of one ride should be one group to resolve, not two overlapping pairs.
 *
 * Bucketed by day and type first, so this is linear in the library rather than
 * comparing every workout with every other. A library of five thousand would
 * otherwise be twelve million comparisons on the main thread.
 */
export function findDuplicateGroups(workouts: Workout[]): Workout[][] {
  const byDay = new Map<string, Workout[]>()
  for (const w of workouts) {
    const key = `${w.date}|${w.type}`
    const bucket = byDay.get(key)
    if (bucket) bucket.push(w)
    else byDay.set(key, [w])
  }

  const groups: Workout[][] = []
  for (const bucket of byDay.values()) {
    if (bucket.length < 2) continue
    const placed = new Set<string>()
    for (const seed of bucket) {
      if (placed.has(seed.id)) continue
      const group = [seed]
      placed.add(seed.id)
      // Grown rather than compared once: a member added below can pull in a
      // third workout that the seed alone would not have matched.
      for (let i = 0; i < group.length; i++) {
        for (const other of bucket) {
          if (placed.has(other.id)) continue
          if (!looksLikeSame(group[i], other)) continue
          group.push(other)
          placed.add(other.id)
        }
      }
      if (group.length > 1) {
        // Oldest first, so the one to keep is the one at the top: whichever
        // arrived first is the copy the library has had the longest.
        group.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
        groups.push(group)
      }
    }
  }
  return groups.sort((a, b) => b[0].date.localeCompare(a[0].date))
}

/**
 * Everything in each group except the one to keep.
 *
 * The first of each group, which is the earliest import — the copy that has
 * been in the library longest, and the one whose id any share link already
 * points at.
 */
export function redundantIds(groups: Workout[][]): string[] {
  return groups.flatMap(g => g.slice(1).map(w => w.id))
}
