import { compareBySort, type SortKey } from '../components/SortDropdown'
import { type Workout, type WorkoutType } from '../data/workouts'
import { filterByRange } from './range'

/** Which library is on screen. */
export type Scope = 'mine' | 'shared' | 'public'

/**
 * Something a workout either has or does not, filterable independently of the
 * others.
 *
 * They combine with AND — asking for photos *and* heart rate means both — which
 * is the only reading of several switches that does not surprise anyone.
 *
 * `notes` is deliberately last and deliberately owner-only: notes are redacted
 * on other people's workouts, so on a feed the filter could only ever answer
 * "none of them", which is worse than not offering it. See CONTAINS_OPTIONS in
 * ContainsDropdown for where that is decided.
 */
export type Has = 'photos' | 'gps' | 'hr' | 'steps' | 'comments' | 'weather' | 'notes'

/** Whether one workout satisfies one attribute. */
function hasAttribute(w: Workout, k: Has): boolean {
  switch (k) {
    case 'photos': return (w.photoCount ?? 0) > 0
    // hasRoute rather than route.length: a list row carries no route, which is
    // the whole reason the server sends the flag.
    case 'gps': return w.hasRoute === true
    case 'hr': return (w.avgHR ?? 0) > 0
    case 'steps': return (w.steps ?? 0) > 0
    case 'comments': return (w.commentCount ?? 0) > 0
    case 'weather': return w.weather !== undefined
    case 'notes': return (w.notes ?? '').trim() !== ''
  }
}

/**
 * Everything the workout list is narrowed and ordered by, kept together so it
 * can be persisted, reset and reasoned about as one value.
 */
export interface WorkoutFilters {
  scope: Scope
  search: string
  /** Attributes every shown workout must have. Empty means no such filter. */
  has: Has[]
  typeFilter: WorkoutType | 'All'
  sortBy: SortKey
  rangeDays: number
  /** Set by a notification link; shows only what the folder watch brought in. */
  originFilter: 'autoimport' | null
  /** Epoch millis. With originFilter, narrows it to one scan's worth. */
  since: number | null
  /**
   * Epoch millis, inclusive. Closes the window at the top so a notification read
   * tomorrow still describes the batch it was written for, rather than growing
   * to swallow every scan since.
   */
  until: number | null
}

export const DEFAULT_FILTERS: WorkoutFilters = {
  scope: 'mine',
  search: '',
  has: [],
  typeFilter: 'All',
  sortBy: 'date-desc',
  rangeDays: 0,
  originFilter: null,
  since: null,
  until: null,
}

/**
 * Applies every filter, then the sort.
 *
 * A pure function rather than a block inside the page, because this is where
 * "which workouts am I looking at" is actually decided, and a wrong answer here
 * is invisible — a list that looks perfectly plausible while showing the wrong
 * rows. Out here it can be tested; inside a component it could not.
 */
export function applyWorkoutFilters(list: Workout[], f: WorkoutFilters): Workout[] {
  let result = [...list]
  if (f.typeFilter !== 'All') result = result.filter(w => w.type === f.typeFilter)
  if (f.search) {
    const needle = f.search.toLowerCase()
    result = result.filter(w => w.name.toLowerCase().includes(needle))
  }
  if (f.originFilter) {
    result = result.filter(w => w.source === f.originFilter)
    // `since` comes from the notification that led here and marks when that scan
    // began, so this is what makes "3 workouts imported" show those three rather
    // than every workout the folder watch has ever brought in.
    //
    // createdAt is when the workout entered the library — never its own date. An
    // import routinely brings in a run from years ago, so filtering on the
    // activity's date would show nothing at all.
    //
    // `until` closes it at the top. Without it the window keeps growing: open a
    // notification from this morning after another scan has run, and the batch
    // of three shows five — still captioned as that batch.
    if (f.since !== null) {
      result = result.filter(w => {
        const at = w.createdAt ? Date.parse(w.createdAt) : NaN
        if (Number.isNaN(at) || at < f.since!) return false
        return f.until === null || at <= f.until
      })
    }
  }
  // Every attribute asked for, not any of them.
  for (const k of f.has) {
    result = result.filter(w => hasAttribute(w, k))
  }
  result = filterByRange(result, f.rangeDays)
  result.sort(compareBySort(f.sortBy))
  return result
}

/**
 * Workouts matching a free-text query, for picking one out of a library.
 *
 * Searched against the whole list already in memory rather than against the
 * server: every page renders from that cache, so a query costs nothing, answers
 * on the keystroke, and works offline — a search endpoint would have been a
 * round trip and a rate limit to say the same thing.
 *
 * Name, sport and date all match, because none of the three alone finds the
 * workout you are thinking of: "the ride in March" and "Morning Run" are both
 * things a person types. The date is matched in ISO form, which is what makes
 * "2026-03" narrow to a month.
 *
 * Newest first and capped, since this feeds a picker: a list of every workout
 * ever recorded is not a search result, and scrolling one is slower than typing
 * another word.
 */
export function searchWorkouts(
  list: Workout[],
  query: string,
  exclude: ReadonlySet<string> = new Set(),
  limit = 40,
): Workout[] {
  const needle = query.trim().toLowerCase()
  const out: Workout[] = []
  // Sorted first, so the cap keeps the newest matches rather than whichever
  // ones happen to come first in the cache.
  for (const w of [...list].sort(compareBySort('date-desc'))) {
    if (exclude.has(w.id)) continue
    if (needle && !(
      w.name.toLowerCase().includes(needle)
      || w.type.toLowerCase().includes(needle)
      || w.date.includes(needle)
    )) continue
    out.push(w)
    if (out.length >= limit) break
  }
  return out
}

/**
 * Reads the auto-import handoff out of a URL query string.
 *
 * Returns null when there is nothing to claim, so a caller can tell "no link"
 * from "a link with no time window" — the second still filters, it just cannot
 * narrow to one scan, which is what happens with a notification produced before
 * the server sent one.
 */
export function parseAutoImportParams(
  search: string,
): { originFilter: 'autoimport'; since: number | null; until: number | null } | null {
  const params = new URLSearchParams(search)
  if (params.get('source') !== 'autoimport') return null
  const at = (name: string) => {
    const t = Date.parse(params.get(name) ?? '')
    return Number.isNaN(t) ? null : t
  }
  const since = at('since')
  // A half-open window is not one: an upper bound with no lower bound would read
  // as "everything ever", and a link from an older server sends neither.
  return { originFilter: 'autoimport', since, until: since === null ? null : at('until') }
}

/**
 * What to call the chip for an auto-import link.
 *
 * Named after *when* rather than "Just imported", because a notification is
 * permanent and gets opened whenever the user gets to it. "Just" is true for
 * about a minute; read tomorrow it is simply wrong, and worse, it makes two
 * different notifications produce chips that read identically.
 *
 * Same day gets a clock time, since several scans in one day is the normal case
 * and the date alone would not tell them apart.
 */
export function describeImportWindow(since: number | null, now: number = Date.now()): string {
  if (since === null) return 'Auto imported'
  const at = new Date(since)
  const sameDay = new Date(now).toDateString() === at.toDateString()
  return sameDay
    ? `Imported ${at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
    : `Imported ${at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
}
