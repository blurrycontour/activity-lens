import { describe, expect, it } from 'vitest'
import { claimGoalCelebration, goalCelebrationSignature } from '../goalCelebration'
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

describe('goal celebration claims', () => {
  it('claims a completed period once, including after Dashboard remounts', () => {
    const storage = new MapStorage()
    expect(claimGoalCelebration(progress(), storage)).toBe(true)
    expect(claimGoalCelebration(progress(), storage)).toBe(false)
  })

  it('claims the next period independently', () => {
    const storage = new MapStorage()
    expect(claimGoalCelebration(progress(), storage)).toBe(true)
    expect(claimGoalCelebration(progress(2, '2026-08-31'), storage)).toBe(true)
  })

  it('does not claim incomplete or empty goal sets', () => {
    expect(goalCelebrationSignature(progress(1))).toBeNull()
    expect(goalCelebrationSignature([])).toBeNull()
  })
})

class MapStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}