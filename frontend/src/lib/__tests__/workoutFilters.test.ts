import { describe, expect, it } from 'vitest'
import { type Workout } from '../../data/workouts'
import {
  applyWorkoutFilters, DEFAULT_FILTERS, describeImportWindow, parseAutoImportParams,
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
