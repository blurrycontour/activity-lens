import { describe, expect, it } from 'vitest'
import { type Workout } from '../../data/workouts'
import { type PlanSession, type TrainingPlan } from '../../data/plans'
import {
  applyItemFilters, asPlanItem, asSessionItem, asWorkoutItem, forKind, NO_NARROWING, sortsFor,
  type ItemNarrowing,
} from '../itemFilters'

/**
 * "Which rows am I looking at" is the one question a feed answers, and a wrong
 * answer here is invisible — a perfectly plausible list showing the wrong
 * things. The cases that earn their keep are the ones where three kinds share
 * one narrowing: a workout-only filter must not silently delete every plan,
 * and a sort that a kind cannot answer must not survive a kind switch.
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

function plan(over: Partial<TrainingPlan> = {}): TrainingPlan {
  return {
    id: Math.random().toString(36).slice(2),
    name: 'Push Pull Legs',
    notes: '',
    archived: false,
    dayCount: 3,
    createdAt: '2026-07-01T10:00:00Z',
    updatedAt: '2026-07-20T10:00:00Z',
    ...over,
  }
}

function session(over: Partial<PlanSession> = {}): PlanSession {
  return {
    id: Math.random().toString(36).slice(2),
    planName: 'Push Pull Legs',
    dayName: 'Push Day',
    snapshot: { id: 'd', name: 'Push Day', blocks: [] },
    progress: { blocks: {} },
    startedAt: '2026-07-25T18:00:00Z',
    finishedAt: '2026-07-25T19:00:00Z',
    doneSets: 10,
    totalSets: 10,
    volumeKg: 0,
    notes: '',
    ...over,
  }
}

const N = (over: Partial<ItemNarrowing> = {}): ItemNarrowing => ({ ...NO_NARROWING, ...over })

describe('applyItemFilters — a filter belonging to one kind', () => {
  const items = [
    asWorkoutItem(workout({ name: 'A ride', type: 'Ride' })),
    asPlanItem(plan({ name: 'A plan' })),
    asSessionItem(session({ dayName: 'A session' })),
  ]

  it('leaves the other kinds alone when everything is shown', () => {
    // The trap this guards: filtering `w.type === 'Ride'` across a mixed list
    // drops every plan and session too, because neither has a type. Under
    // "Everything" the activity filter is not even offered, but the narrowing
    // survives a kind switch in session storage, so the predicate has to cope.
    const got = applyItemFilters(items, N({ typeFilter: 'Ride' }))
    expect(got.map(i => i.kind).sort()).toEqual(['plan', 'session', 'workout'])
  })

  it('still narrows the kind it belongs to', () => {
    const two = [
      asWorkoutItem(workout({ name: 'A ride', type: 'Ride' })),
      asWorkoutItem(workout({ name: 'A run', type: 'Run' })),
    ]
    expect(applyItemFilters(two, N({ typeFilter: 'Ride' }))).toHaveLength(1)
  })

  it('shows only the chosen kind', () => {
    expect(applyItemFilters(items, N({ kind: 'plan' })).map(i => i.kind)).toEqual(['plan'])
  })
})

describe('applyItemFilters — plan and session filters', () => {
  it('bands plans by day count', () => {
    const items = [1, 2, 3, 5].map(d => asPlanItem(plan({ dayCount: d })))
    const days = (v: ItemNarrowing['planDays']) =>
      applyItemFilters(items, N({ kind: 'plan', planDays: v })).map(i => i.plan!.dayCount).sort()
    expect(days('1')).toEqual([1])
    expect(days('2-3')).toEqual([2, 3])
    expect(days('4+')).toEqual([5])
  })

  it('separates a session that finished every set from one cut short', () => {
    const items = [
      asSessionItem(session({ dayName: 'Whole thing', doneSets: 10, totalSets: 10 })),
      asSessionItem(session({ dayName: 'Cut short', doneSets: 4, totalSets: 10 })),
    ]
    const named = (v: ItemNarrowing['sessionStatus']) =>
      applyItemFilters(items, N({ kind: 'session', sessionStatus: v })).map(i => i.session!.dayName)
    expect(named('complete')).toEqual(['Whole thing'])
    expect(named('partial')).toEqual(['Cut short'])
  })

  it('finds plans that have notes, and plans that have been run', () => {
    const items = [
      asPlanItem(plan({ name: 'Noted', notes: 'go heavy' })),
      asPlanItem(plan({ name: 'Run before', lastSessionAt: '2026-07-02T10:00:00Z' })),
      asPlanItem(plan({ name: 'Bare' })),
    ]
    expect(applyItemFilters(items, N({ kind: 'plan', traits: ['notes'] })).map(i => i.plan!.name))
      .toEqual(['Noted'])
    expect(applyItemFilters(items, N({ kind: 'plan', traits: ['run'] })).map(i => i.plan!.name))
      .toEqual(['Run before'])
  })
})

describe('applyItemFilters — sorting a mixed list', () => {
  it('interleaves the three kinds by recency', () => {
    const items = [
      asPlanItem(plan({ name: 'plan', updatedAt: '2026-07-20T10:00:00Z' })),
      asWorkoutItem(workout({ name: 'workout', date: '2026-07-28' })),
      asSessionItem(session({ dayName: 'session', startedAt: '2026-07-25T18:00:00Z' })),
    ]
    expect(applyItemFilters(items, N()).map(i => i.kind)).toEqual(['workout', 'session', 'plan'])
  })

  it('sorts plans by name, and by how recently they were run', () => {
    const items = [
      asPlanItem(plan({ name: 'Beta', lastSessionAt: '2026-07-10T10:00:00Z' })),
      asPlanItem(plan({ name: 'Alpha', lastSessionAt: '2026-07-20T10:00:00Z' })),
      asPlanItem(plan({ name: 'Never' })),
    ]
    expect(applyItemFilters(items, N({ kind: 'plan', sortBy: 'name-asc' })).map(i => i.plan!.name))
      .toEqual(['Alpha', 'Beta', 'Never'])
    // Never-run sorts last rather than first: a wall of plans you have not
    // touched is not an answer to "what have I done lately".
    expect(applyItemFilters(items, N({ kind: 'plan', sortBy: 'lastrun-desc' })).map(i => i.plan!.name))
      .toEqual(['Alpha', 'Beta', 'Never'])
  })
})

describe('forKind', () => {
  it('drops a sort the new kind cannot answer', () => {
    const n = N({ kind: 'workout', sortBy: 'distance-desc' })
    expect(forKind(n, 'plan').sortBy).toBe('date-desc')
  })

  it('keeps a sort both kinds share', () => {
    expect(forKind(N({ kind: 'workout', sortBy: 'date-asc' }), 'plan').sortBy).toBe('date-asc')
  })

  it('clears the filters that no longer have a control', () => {
    // Without this a chip goes on claiming "Ride" over a list of plans, and
    // clearing it is impossible because the group it belongs to is gone.
    const n = N({ kind: 'workout', typeFilter: 'Ride', has: ['photos'] })
    const next = forKind(n, 'session')
    expect(next.typeFilter).toBe('All')
    expect(next.has).toEqual([])
  })

  it('offers each kind only the sorts it can answer', () => {
    expect(sortsFor('all')).toEqual(['date-desc', 'date-asc'])
    expect(sortsFor('workout')).toContain('distance-desc')
    expect(sortsFor('plan')).toContain('days-desc')
    expect(sortsFor('plan')).not.toContain('distance-desc')
    expect(sortsFor('session')).toContain('sets-desc')
  })
})

describe('applyItemFilters — search and period', () => {
  it('searches every kind by its own words', () => {
    const items = [
      asWorkoutItem(workout({ name: 'Morning Run' })),
      asPlanItem(plan({ name: 'Push Pull Legs' })),
      asSessionItem(session({ dayName: 'Leg Day' })),
    ]
    expect(applyItemFilters(items, N({ search: 'leg' })).map(i => i.kind).sort())
      .toEqual(['plan', 'session'])
  })

  it('compares a plan timestamp against a date boundary correctly', () => {
    // `at` is RFC 3339 for a plan and YYYY-MM-DD for a workout, and both are
    // compared as strings against a YYYY-MM-DD start. The longer form only
    // has more characters *after* the part being compared, so this holds —
    // but it holds by argument rather than by construction, hence the test.
    const items = [
      asPlanItem(plan({ name: 'recent', updatedAt: '2026-07-28T23:59:00Z' })),
      asPlanItem(plan({ name: 'old', updatedAt: '2026-01-01T00:00:00Z' })),
    ]
    const got = applyItemFilters(items, N({ rangeDays: 7 }), new Date('2026-07-30T12:00:00Z'))
    expect(got.map(i => i.plan!.name)).toEqual(['recent'])
  })
})
