import { describe, expect, it } from 'vitest'
import { bylinePeople } from '../WorkoutFilterList'
import type { Workout } from '../../data/workouts'

const who = { id: 7, username: 'sam', displayName: 'Sam', avatarPath: '' }

/** Just enough workout for the byline; the rest of the row is not its business. */
function row(extra: Partial<Workout> = {}): Workout {
  return { id: 'w1', name: 'Morning run', ...extra } as Workout
}

/*
 * The footer is drawn when there is somebody to name, and the card wraps
 * whatever it is given in a rule and its padding. A component that renders null
 * is still a truthy prop, so "no byline" used to reach the card as a footer with
 * nothing in it — a stray horizontal line under every row on a profile tab and
 * in the public feed. This is the function the card now asks first.
 */
describe('bylinePeople', () => {
  it('names nobody when no byline was asked for', () => {
    expect(bylinePeople(row({ owner: who }))).toEqual([])
  })

  it('names the owner of someone else’s workout', () => {
    expect(bylinePeople(row({ owner: who }), 'owner')).toEqual([who])
  })

  // The case behind the bug: every tab of a profile asks for the owner byline's
  // sibling arrangement, but rows on one person's own profile carry no owner —
  // it means "belongs to someone else" — so there is nothing to name.
  it('names nobody when the byline is asked for and the field is absent', () => {
    expect(bylinePeople(row(), 'owner')).toEqual([])
    expect(bylinePeople(row(), 'recipients')).toEqual([])
    expect(bylinePeople(row({ sharedWith: [] }), 'recipients')).toEqual([])
  })

  it('names everyone a workout was sent to', () => {
    expect(bylinePeople(row({ sharedWith: [who] }), 'recipients')).toEqual([who])
  })
})
