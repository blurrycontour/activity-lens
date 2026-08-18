import type { Workout } from '../data/workouts'
import type { PlanSession, TrainingPlan } from '../data/plans'

/**
 * Turning a date into the words someone would actually type to find it.
 *
 * "Sunday", "August", "2026" are all real searches for a thing remembered by
 * when it happened rather than by its name — and a bare ISO string does not
 * match any of them. Spelled out once here rather than per haystack, so a
 * plan, a session and a workout all become findable the same way.
 */
function dateWords(iso: string | undefined): string[] {
  if (!iso) return []
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return []
  return [d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })]
}

function timeWords(iso: string | undefined): string[] {
  if (!iso) return []
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return []
  return [d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })]
}

/**
 * Everything about a plan worth typing to find it, lowercased once.
 *
 * A name is not the only thing you remember about a plan — "the one I last
 * did on a Tuesday" or "the four-day one" are just as real a search. Every
 * date the plan carries is spelled out in words alongside it.
 */
export function planHaystack(p: TrainingPlan): string {
  const dates = [p.createdAt, p.updatedAt, p.lastSessionAt].filter((s): s is string => !!s)
  return [
    p.name, `${p.dayCount} day${p.dayCount === 1 ? '' : 's'}`,
    ...dates.flatMap(dateWords),
  ].join(' ').toLowerCase()
}

/**
 * Everything about a session worth typing to find it, lowercased once.
 *
 * A day and plan name are not how most sessions get remembered — "the one on
 * Sunday" or "12 of 15" is just as real a search. The set tally is included
 * both as a fraction and as words, so either form matches.
 */
export function sessionHaystack(s: PlanSession): string {
  return [
    s.dayName, s.planName, ...dateWords(s.startedAt), ...timeWords(s.startedAt),
    `${s.doneSets}/${s.totalSets}`, `${s.doneSets} of ${s.totalSets} sets`,
  ].join(' ').toLowerCase()
}

/** The workout equivalent, for Discover's mixed feed — name, type and date. */
export function workoutHaystack(w: Workout): string {
  return [w.name, w.type, ...dateWords(w.date), ...timeWords(w.startTime)].join(' ').toLowerCase()
}
