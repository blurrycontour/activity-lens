import { describe, expect, it } from 'vitest'
import { type Workout } from '../../data/workouts'
import {
  applyWorkoutFilters, DEFAULT_FILTERS, describeImportWindow, parseAutoImportParams, searchWorkouts,
  type Has,
} from '../workoutFilters'

/**
 * "Which workouts am I looking at" is the one question this page answers, and a
 * wrong answer is invisible — a plausible-looking list showing the wrong rows.
 * The auto-import window in particular shipped twice before it worked end to
 * end, so it gets the coverage.
 */

function workout(over: Partial<Workout> = {}): Workout {
  return {
    id: Math.random().toString(36).slice(2),
    name: 'Morning Run',
    type: 'Run',
    date: '2026-07-30',
    duration: 1800,
    distance: 5000,
    avgHR: 140,
    maxHR: 165,
    elevationGain: 40,
    calories: 300,
    route: [],
    hrTimeline: [],
    paceTimeline: [],
    elevTimeline: [],
    notes: '',
    ...over,
  } as Workout
}

const AT = (iso: string) => Date.parse(iso)

describe('applyWorkoutFilters — the auto-import window', () => {
  const scanStarted = AT('2026-07-31T11:36:00Z')
  const list = [
    workout({ name: 'Just imported', source: 'autoimport', createdAt: '2026-07-31T11:36:45Z' }),
    workout({ name: 'Also just imported', source: 'autoimport', createdAt: '2026-07-31T11:36:50Z' }),
    workout({ name: 'Imported last week', source: 'autoimport', createdAt: '2026-07-24T09:00:00Z' }),
    workout({ name: 'Uploaded by hand', source: 'upload', createdAt: '2026-07-31T11:36:47Z' }),
  ]

  it('shows only the batch the notification was about', () => {
    const got = applyWorkoutFilters(list, { ...DEFAULT_FILTERS, originFilter: 'autoimport', since: scanStarted })
    expect(got.map(w => w.name).sort()).toEqual(['Also just imported', 'Just imported'])
  })

  it('falls back to every auto-import when the link carried no window', () => {
    // What an older notification produces: better than nothing, and the reason
    // "it still shows everything" is a symptom rather than a broken filter.
    const got = applyWorkoutFilters(list, { ...DEFAULT_FILTERS, originFilter: 'autoimport', since: null })
    expect(got).toHaveLength(3)
  })

  it('never lets a hand-uploaded workout through the origin filter', () => {
    const got = applyWorkoutFilters(list, { ...DEFAULT_FILTERS, originFilter: 'autoimport', since: null })
    expect(got.some(w => w.source === 'upload')).toBe(false)
  })

  it('filters on when it was imported, not when the run happened', () => {
    // The case that makes the activity's own date useless here: a run from years
    // ago, imported a moment ago. Filtering on `date` would show nothing.
    const old = workout({ name: 'A run from 2019', date: '2019-03-01', source: 'autoimport', createdAt: '2026-07-31T11:36:45Z' })
    const got = applyWorkoutFilters([old], { ...DEFAULT_FILTERS, originFilter: 'autoimport', since: scanStarted })
    expect(got).toHaveLength(1)
  })

  it('drops a row with no createdAt rather than guessing it belongs', () => {
    const nameless = workout({ source: 'autoimport', createdAt: undefined })
    const got = applyWorkoutFilters([nameless], { ...DEFAULT_FILTERS, originFilter: 'autoimport', since: scanStarted })
    expect(got).toHaveLength(0)
  })

  it('ignores the window entirely when no origin filter is set', () => {
    const got = applyWorkoutFilters(list, { ...DEFAULT_FILTERS, since: scanStarted })
    expect(got).toHaveLength(4)
  })
})

describe('applyWorkoutFilters — the window is closed at both ends', () => {
  // The bug this exists for: a notification is permanent, and by the time it is
  // opened the folder watch has usually run again. With only a lower bound, the
  // older notification quietly grew to include the newer import — and still
  // called itself the same batch.
  const batch = { since: AT('2026-07-31T11:36:00Z'), until: AT('2026-07-31T11:37:00Z') }
  const list = [
    workout({ name: 'In the batch', source: 'autoimport', createdAt: '2026-07-31T11:36:45Z' }),
    workout({ name: 'A later scan', source: 'autoimport', createdAt: '2026-07-31T14:02:00Z' }),
  ]

  it('excludes a workout imported after the notification was written', () => {
    const got = applyWorkoutFilters(list, { ...DEFAULT_FILTERS, originFilter: 'autoimport', ...batch })
    expect(got.map(w => w.name)).toEqual(['In the batch'])
  })

  it('includes a workout landing exactly on the upper bound', () => {
    // The bound is one of the batch's own created_at values, so it must be
    // inclusive or the newest workout falls out of its own window.
    const edge = workout({ name: 'Newest', source: 'autoimport', createdAt: '2026-07-31T11:37:00Z' })
    const got = applyWorkoutFilters([edge], { ...DEFAULT_FILTERS, originFilter: 'autoimport', ...batch })
    expect(got.map(w => w.name)).toEqual(['Newest'])
  })

  it('stays open-ended when only a lower bound is known', () => {
    // Notifications written before `until` existed keep their stored link
    // forever, so this path has to go on working.
    const got = applyWorkoutFilters(list, {
      ...DEFAULT_FILTERS, originFilter: 'autoimport', since: batch.since, until: null,
    })
    expect(got).toHaveLength(2)
  })
})

describe('describeImportWindow', () => {
  const now = AT('2026-07-31T18:00:00Z')

  it('names a same-day batch by its time, so two scans read differently', () => {
    const morning = describeImportWindow(AT('2026-07-31T09:15:00Z'), now)
    const noon = describeImportWindow(AT('2026-07-31T12:45:00Z'), now)
    expect(morning).toMatch(/^Imported /)
    expect(morning).not.toEqual(noon)
  })

  it('names an older batch by its date rather than calling it "just" anything', () => {
    const label = describeImportWindow(AT('2026-07-24T09:15:00Z'), now)
    expect(label).toMatch(/^Imported /)
    expect(label).not.toMatch(/Just/)
  })

  it('falls back to a plain label when there is no window to name', () => {
    expect(describeImportWindow(null, now)).toBe('Auto imported')
  })
})

describe('parseAutoImportParams', () => {
  it('reads the link the notification carries, colons and all', () => {
    // What autoImportLink produces server-side, percent-encoded.
    expect(parseAutoImportParams(
      '?source=autoimport&since=2026-07-31T11%3A36%3A45Z&until=2026-07-31T11%3A36%3A49Z',
    )).toEqual({
      originFilter: 'autoimport',
      since: AT('2026-07-31T11:36:45Z'),
      until: AT('2026-07-31T11:36:49Z'),
    })
  })

  it('accepts a link with no window', () => {
    expect(parseAutoImportParams('?source=autoimport'))
      .toEqual({ originFilter: 'autoimport', since: null, until: null })
  })

  it('ignores an unparseable timestamp instead of filtering to nothing', () => {
    expect(parseAutoImportParams('?source=autoimport&since=yesterday')).toEqual({
      originFilter: 'autoimport',
      since: null,
      until: null,
    })
  })

  it('claims nothing from an ordinary visit to the page', () => {
    expect(parseAutoImportParams('')).toBeNull()
    expect(parseAutoImportParams('?tab=shared')).toBeNull()
  })
})

/**
 * The picker on the gear page runs on this, against the whole library in
 * memory. Two of its rules are the kind that fail quietly: an exclusion that
 * stops working offers a workout the equipment already has, and a cap applied
 * before the sort silently hides the recent workouts people are actually
 * looking for.
 */
describe('searchWorkouts', () => {
  const list = [
    workout({ id: 'a', name: 'Morning Run', type: 'Run', date: '2026-03-04' }),
    workout({ id: 'b', name: 'Evening Ride', type: 'Ride', date: '2026-03-19' }),
    workout({ id: 'c', name: 'Long hill repeats', type: 'Run', date: '2025-11-02' }),
  ]

  it('matches on name, sport or date', () => {
    const ids = (q: string) => searchWorkouts(list, q).map(w => w.id)
    expect(ids('morning')).toEqual(['a'])
    // Case-insensitive, and the sport is a search term of its own — "the ride
    // in March" is a thing people type, and neither half is in the name.
    expect(ids('RIDE')).toEqual(['b'])
    expect(ids('2026-03').sort()).toEqual(['a', 'b'])
    expect(ids('nothing here')).toEqual([])
    // No query lists everything, which is what the picker opens on.
    expect(ids('')).toHaveLength(3)
  })

  it('leaves out what is already linked', () => {
    const got = searchWorkouts(list, '', new Set(['a', 'c']))
    expect(got.map(w => w.id)).toEqual(['b'])
  })

  it('caps the list at the newest matches, not the first ones it happens to see', () => {
    // Sorting after capping would keep three arbitrary workouts and then order
    // those, so the run from yesterday would be missing from a search that
    // matched everything — the exact case the picker is for.
    const many = Array.from({ length: 60 }, (_, i) =>
      workout({ id: `w${i}`, name: 'Run', date: `2026-01-${String(i % 28 + 1).padStart(2, '0')}` }))
    const newest = workout({ id: 'newest', name: 'Run', date: '2026-09-09' })
    const got = searchWorkouts([...many, newest], 'run', new Set(), 10)
    expect(got).toHaveLength(10)
    expect(got[0].id).toBe('newest')
  })
})

/**
 * The "contains" filters. Each attribute reads a different field, and several
 * of them read a field that is absent rather than false on rows the server did
 * not annotate — so the failure mode is a filter that silently matches nothing,
 * or worse, everything.
 */
describe('applyWorkoutFilters — what a workout contains', () => {
  const withPhotos = workout({ id: 'photos', photoCount: 2 })
  const withGps = workout({ id: 'gps', hasRoute: true })
  const withBoth = workout({ id: 'both', photoCount: 1, hasRoute: true, notes: 'felt good' })
  // Nothing annotated at all: what a row from an older server looks like.
  const bare = workout({ id: 'bare', avgHR: 0, notes: '' })
  const list = [withPhotos, withGps, withBoth, bare]

  const ids = (has: Has[]) =>
    applyWorkoutFilters(list, { ...DEFAULT_FILTERS, has }).map(w => w.id).sort()

  it('keeps only workouts with the attribute', () => {
    expect(ids(['photos'])).toEqual(['both', 'photos'])
    expect(ids(['gps'])).toEqual(['both', 'gps'])
    expect(ids(['notes'])).toEqual(['both'])
  })

  it('narrows on every attribute asked for, not any of them', () => {
    expect(ids(['photos', 'gps'])).toEqual(['both'])
  })

  it('leaves the list alone when nothing is asked for', () => {
    expect(ids([])).toHaveLength(4)
  })

  // An absent count is "we were not told", which for a filter has to mean the
  // same as none: matching it would put every unannotated row into every list.
  it('treats a missing count as not having it', () => {
    expect(ids(['comments'])).toEqual([])
    expect(ids(['weather'])).toEqual([])
  })

  it('reads heart rate and steps from the row itself', () => {
    // The shared workout() helper carries a heart rate; only `bare` clears it.
    expect(ids(['hr'])).toEqual(['both', 'gps', 'photos'])
    expect(ids(['steps'])).toEqual([])
  })
})
