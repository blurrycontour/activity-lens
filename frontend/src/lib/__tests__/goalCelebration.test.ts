import { describe, expect, it } from 'vitest'
import { goalsAreComplete } from '../goalCelebration'
import type { GoalProgress } from '../insights'

function progress(current = 2, period = '2026-08-24'): GoalProgress[] {
  return [{
    goal: { id: 'runs', metric: 'count', target: 2, period: 'week', span: 1, type: 'Run', minKm: 0, minMinutes: 0 },
    current,
    elapsed: 0.5,
    streak: 1,
    bestStreak: 1,
    history: [{ key: period, value: current, met: current >= 2 }],
  }]
}

describe('goal celebration eligibility', () => {
  it('celebrates completed goals whenever Dashboard mounts', () => {
    expect(goalsAreComplete(progress())).toBe(true)
    expect(goalsAreComplete(progress())).toBe(true)
  })

  it('does not celebrate incomplete or empty goal sets', () => {
    expect(goalsAreComplete(progress(1))).toBe(false)
    expect(goalsAreComplete([])).toBe(false)
  })
})
