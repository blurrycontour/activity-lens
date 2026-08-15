import { describe, expect, it } from 'vitest'
import { emptyPlan, parseClock, planChanges } from '../../components/WorkoutReshape'
import type { Workout } from '../../data/workouts'

const w = { duration: 3600, distance: 10000 } as Workout

/**
 * The time box and the "is anything staged" test.
 *
 * Both decide whether a destructive edit happens: a plan wrongly reported as
 * unchanged skips the confirmation entirely, and a mis-parsed time trims to a
 * point nobody chose.
 */
describe('parseClock', () => {
  it('reads the forms a person types', () => {
    expect(parseClock('8:30')).toBe(510)
    expect(parseClock('1:08:30')).toBe(4110)
    // A bare number is seconds, which is what a paste from elsewhere looks like.
    expect(parseClock('90')).toBe(90)
    expect(parseClock(' 0:00 ')).toBe(0)
  })

  it('returns null for anything it cannot read, rather than a guess', () => {
    // The caller keeps the previous value on null; guessing 0 here would jump
    // the handle to the start mid-keystroke.
    expect(parseClock('abc')).toBeNull()
    expect(parseClock('8:3x')).toBeNull()
    expect(parseClock('1:2:3:4')).toBeNull()
  })

  // Half-typed input is the normal state of a text box, not an error.
  it('tolerates an empty segment', () => {
    expect(parseClock('8:')).toBe(480)
    expect(parseClock(':30')).toBe(30)
  })
})

describe('planChanges', () => {
  it('is false for an untouched plan', () => {
    expect(planChanges(w, emptyPlan(w))).toBe(false)
  })

  it('is true once anything is staged', () => {
    expect(planChanges(w, { ...emptyPlan(w), start: 5 })).toBe(true)
    expect(planChanges(w, { ...emptyPlan(w), end: 3599 })).toBe(true)
    expect(planChanges(w, { ...emptyPlan(w), drop: ['cadence'] })).toBe(true)
  })
})
