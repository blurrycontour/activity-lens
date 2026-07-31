import { compareBySort, type SortKey } from '../components/SortDropdown'
import { type Workout, type WorkoutType } from '../data/workouts'
import { filterByRange } from './range'

/** Which library is on screen. */
export type Scope = 'mine' | 'shared' | 'public'

/**
 * Everything the workout list is narrowed and ordered by, kept together so it
 * can be persisted, reset and reasoned about as one value.
 */
export interface WorkoutFilters {
  scope: Scope
  search: string
  typeFilter: WorkoutType | 'All'
  sortBy: SortKey
  rangeDays: number
  sharedOnly: boolean
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
  typeFilter: 'All',
  sortBy: 'date-desc',
  rangeDays: 0,
  sharedOnly: false,
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
  // Sharing only narrows your own library; elsewhere every row is someone
  // else's and the filter would mean nothing.
  if (f.scope === 'mine' && f.sharedOnly) {
    result = result.filter(w => w.visibility === 'public' || (w.sharedWithCount ?? 0) > 0)
  }
  result = filterByRange(result, f.rangeDays)
  result.sort(compareBySort(f.sortBy))
  return result
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
