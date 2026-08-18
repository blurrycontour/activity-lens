import type { Workout, WorkoutType } from '../data/workouts'
import type { PlanSession, TrainingPlan } from '../data/plans'
import { hasKey, isNegated, type Has, type HasFilter } from './workoutFilters'
import { planHaystack, sessionHaystack, workoutHaystack } from './discoverSearch'
import { rangeStartDate } from './range'

/**
 * Narrowing and ordering for a list that may hold workouts, training plans and
 * finished sessions at once.
 *
 * The workout list has always had real filters — activity, period, contains,
 * six sorts — and the first mixed feed had none of them, because there was no
 * way to express "this group only applies to one of the three kinds". That is
 * what this file adds: one narrowing value, and a description of which parts
 * of it each kind actually answers.
 *
 * The split is deliberate rather than incidental. Search, Period and the two
 * date sorts mean the same thing for all three kinds and are always offered;
 * everything else belongs to one kind and is offered only once that kind is
 * chosen. "Longest distance" over a list of plans is not a stricter filter,
 * it is a meaningless one, and a control that silently does nothing is worse
 * than one that is not there.
 *
 * Kept out of the components for the same reason applyWorkoutFilters is: this
 * is where "which rows am I looking at" is decided, and a wrong answer here is
 * invisible — a perfectly plausible list showing the wrong things.
 */

/** The three things that can share a list. */
export type ItemKind = 'workout' | 'plan' | 'session'

/**
 * One row, tagged with what it is.
 *
 * A union with three optional members rather than a generic, because the list
 * genuinely holds all three at once and every consumer has to switch on the
 * kind anyway. `at` is the one field they are all guaranteed to have, and it
 * is what interleaves them.
 */
export interface FeedItem {
  kind: ItemKind
  id: string
  /** Recency key: a workout's date, a plan's last edit, a session's start. */
  at: string
  workout?: Workout
  plan?: TrainingPlan
  session?: PlanSession
}

export const asWorkoutItem = (w: Workout): FeedItem => ({ kind: 'workout', id: w.id, at: w.date, workout: w })
export const asPlanItem = (p: TrainingPlan): FeedItem => ({ kind: 'plan', id: p.id, at: p.updatedAt, plan: p })
export const asSessionItem = (s: PlanSession): FeedItem => ({ kind: 'session', id: s.id, at: s.startedAt, session: s })

/**
 * Every sort any kind offers. One union rather than one per kind, so the
 * narrowing stays a single value that can be stored and reset as one — and so
 * switching kinds is a validity check (see `sortsFor`) rather than a type
 * change.
 */
export type ItemSortKey =
  // Shared by all three.
  | 'date-desc' | 'date-asc'
  // Workouts.
  | 'distance-desc' | 'distance-asc' | 'duration-desc' | 'duration-asc'
  // Plans.
  | 'name-asc' | 'days-desc' | 'lastrun-desc'
  // Sessions.
  | 'sets-desc' | 'time-desc'

/**
 * Something a plan or a session either has or does not.
 *
 * The workout equivalent is `Has` in workoutFilters, which this deliberately
 * does not extend: those seven are about recorded telemetry (GPS, cadence,
 * weather) and none of them mean anything for a plan.
 */
export type Trait = 'notes' | 'run'

/** How many days a plan has, as a band rather than an exact count. */
export type PlanDaysFilter = 'all' | '1' | '2-3' | '4+'

/** Whether every set a session planned was actually done. */
export type SessionStatus = 'all' | 'complete' | 'partial'

export interface ItemNarrowing {
  /** Which kind is on screen; 'all' interleaves them by recency. */
  kind: ItemKind | 'all'
  search: string
  rangeDays: number
  sortBy: ItemSortKey
  /** Workouts only. */
  typeFilter: WorkoutType | 'All'
  /** Workouts only. */
  has: HasFilter[]
  /** Plans only. */
  planDays: PlanDaysFilter
  /** Sessions only. */
  sessionStatus: SessionStatus
  /** Plans and sessions. */
  traits: Trait[]
}

export const NO_NARROWING: ItemNarrowing = {
  kind: 'all',
  search: '',
  rangeDays: 0,
  sortBy: 'date-desc',
  typeFilter: 'All',
  has: [],
  planDays: 'all',
  sessionStatus: 'all',
  traits: [],
}

/** The sorts a kind can answer. 'all' gets only the two every kind shares. */
export function sortsFor(kind: ItemKind | 'all'): ItemSortKey[] {
  const shared: ItemSortKey[] = ['date-desc', 'date-asc']
  switch (kind) {
    case 'workout': return [...shared, 'distance-desc', 'distance-asc', 'duration-desc', 'duration-asc']
    case 'plan': return [...shared, 'name-asc', 'days-desc', 'lastrun-desc']
    case 'session': return [...shared, 'sets-desc', 'time-desc']
    default: return shared
  }
}

/**
 * The narrowing, with anything the new kind cannot answer dropped.
 *
 * Called whenever the kind changes. Without it, switching from Workouts to
 * Plans with "Longest distance" chosen leaves a list sorted by a field plans
 * do not have — and, worse, leaves a filter chip claiming a narrowing that
 * nothing is applying. Clearing is the honest option: the control is gone, so
 * its value should be too.
 */
export function forKind(n: ItemNarrowing, kind: ItemKind | 'all'): ItemNarrowing {
  const sortBy = sortsFor(kind).includes(n.sortBy) ? n.sortBy : 'date-desc'
  return {
    ...n,
    kind,
    sortBy,
    typeFilter: kind === 'workout' ? n.typeFilter : 'All',
    has: kind === 'workout' ? n.has : [],
    planDays: kind === 'plan' ? n.planDays : 'all',
    sessionStatus: kind === 'session' ? n.sessionStatus : 'all',
    traits: kind === 'plan' || kind === 'session' ? n.traits : [],
  }
}

/** Whether one workout satisfies one attribute. Mirrors workoutFilters. */
function workoutHas(w: Workout, k: Has): boolean {
  switch (k) {
    case 'photos': return (w.photoCount ?? 0) > 0
    case 'gps': return w.hasRoute === true
    case 'hr': return (w.avgHR ?? 0) > 0
    case 'cadence': return w.hasCadence === true
    case 'comments': return (w.commentCount ?? 0) > 0
    case 'weather': return w.weather !== undefined
    case 'notes': return (w.notes ?? '').trim() !== ''
  }
}

/** Whether a plan or session satisfies one trait. */
function itemHasTrait(it: FeedItem, t: Trait): boolean {
  if (t === 'notes') return ((it.plan?.notes ?? it.session?.notes ?? '')).trim() !== ''
  // 'run' is only meaningful for a plan; a session is a run by definition, so
  // the filter is not offered for one and never asked here.
  return !!it.plan?.lastSessionAt
}

/** The words a row can be found by, per kind. */
function haystack(it: FeedItem): string {
  if (it.workout) return workoutHaystack(it.workout)
  if (it.plan) return planHaystack(it.plan)
  return it.session ? sessionHaystack(it.session) : ''
}

/**
 * Orders a mixed list.
 *
 * Every comparator falls back to recency when the field it sorts on does not
 * apply to a row, which only happens under 'all' — where the kind-specific
 * sorts are not offered — and after a kind switch that `forKind` has already
 * reset. Belt and braces, but a comparator that returns NaN silently produces
 * an arbitrary order rather than an error.
 */
export function compareItems(key: ItemSortKey): (a: FeedItem, b: FeedItem) => number {
  const byDate = (a: FeedItem, b: FeedItem) => b.at.localeCompare(a.at)
  switch (key) {
    case 'date-asc': return (a, b) => -byDate(a, b)
    case 'distance-desc': return (a, b) => (b.workout?.distance ?? 0) - (a.workout?.distance ?? 0) || byDate(a, b)
    case 'distance-asc': return (a, b) => (a.workout?.distance ?? 0) - (b.workout?.distance ?? 0) || byDate(a, b)
    case 'duration-desc': return (a, b) => (b.workout?.duration ?? 0) - (a.workout?.duration ?? 0) || byDate(a, b)
    case 'duration-asc': return (a, b) => (a.workout?.duration ?? 0) - (b.workout?.duration ?? 0) || byDate(a, b)
    case 'name-asc': return (a, b) => (a.plan?.name ?? '').localeCompare(b.plan?.name ?? '') || byDate(a, b)
    case 'days-desc': return (a, b) => (b.plan?.dayCount ?? 0) - (a.plan?.dayCount ?? 0) || byDate(a, b)
    // Never run sorts last rather than first: the question "which of these have
    // I actually done recently" is not answered by a wall of ones I never have.
    case 'lastrun-desc': return (a, b) => (b.plan?.lastSessionAt ?? '').localeCompare(a.plan?.lastSessionAt ?? '') || byDate(a, b)
    case 'sets-desc': return (a, b) => (b.session?.doneSets ?? 0) - (a.session?.doneSets ?? 0) || byDate(a, b)
    case 'time-desc': return (a, b) => sessionSeconds(b.session) - sessionSeconds(a.session) || byDate(a, b)
    default: return byDate
  }
}

/** How long a session took, or 0 while it is still running. */
function sessionSeconds(s?: PlanSession): number {
  if (!s?.finishedAt) return 0
  const from = Date.parse(s.startedAt)
  const to = Date.parse(s.finishedAt)
  return Number.isNaN(from) || Number.isNaN(to) ? 0 : Math.max(0, (to - from) / 1000)
}

/** Applies every filter, then the sort. */
export function applyItemFilters(items: FeedItem[], n: ItemNarrowing, now = new Date()): FeedItem[] {
  let out = items
  if (n.kind !== 'all') out = out.filter(i => i.kind === n.kind)

  const q = n.search.trim().toLowerCase()
  if (q) out = out.filter(i => haystack(i).includes(q))

  const start = rangeStartDate(n.rangeDays, now)
  // `at` is RFC 3339 for a plan or session and YYYY-MM-DD for a workout, and
  // both compare correctly against a YYYY-MM-DD boundary as strings — the
  // longer form simply has more characters after the part being compared.
  if (start != null) out = out.filter(i => i.at >= start)

  if (n.typeFilter !== 'All') out = out.filter(i => !i.workout || i.workout.type === n.typeFilter)

  for (const f of n.has) {
    const want = !isNegated(f)
    const k = hasKey(f)
    out = out.filter(i => !i.workout || workoutHas(i.workout, k) === want)
  }

  if (n.planDays !== 'all') {
    out = out.filter(i => {
      if (!i.plan) return true
      const d = i.plan.dayCount
      return n.planDays === '1' ? d === 1 : n.planDays === '2-3' ? d >= 2 && d <= 3 : d >= 4
    })
  }

  if (n.sessionStatus !== 'all') {
    out = out.filter(i => {
      if (!i.session) return true
      const done = i.session.totalSets > 0 && i.session.doneSets >= i.session.totalSets
      return n.sessionStatus === 'complete' ? done : !done
    })
  }

  for (const t of n.traits) {
    out = out.filter(i => (i.kind !== 'plan' && i.kind !== 'session') || itemHasTrait(i, t))
  }

  return [...out].sort(compareItems(n.sortBy))
}

/** Whether anything beyond the search is narrowing the list. */
export function isNarrowed(n: ItemNarrowing): boolean {
  return n.kind !== 'all' || n.rangeDays !== 0 || n.sortBy !== 'date-desc'
    || n.typeFilter !== 'All' || n.has.length > 0
    || n.planDays !== 'all' || n.sessionStatus !== 'all' || n.traits.length > 0
}
