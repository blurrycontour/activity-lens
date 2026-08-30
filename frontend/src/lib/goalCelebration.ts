import type { GoalProgress } from './insights'

const STORAGE_KEY = 'al_goals_celebrated'

export function goalCelebrationSignature(progress: GoalProgress[]): string | null {
  if (progress.length === 0 || progress.some(p => p.current < p.goal.target)) return null
  return JSON.stringify(progress.map(p => ({
    goal: p.goal,
    period: p.history[p.history.length - 1]?.key ?? '',
  })).sort((a, b) => a.goal.id.localeCompare(b.goal.id)))
}

export function claimGoalCelebration(progress: GoalProgress[], storage: Storage = sessionStorage): boolean {
  const signature = goalCelebrationSignature(progress)
  if (!signature) return false
  let seen: string[] = []
  try {
    const stored = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]')
    if (Array.isArray(stored)) seen = stored
  } catch {
    // An older boolean marker is not a claim for this goal set and period.
  }
  if (seen.includes(signature)) return false
  storage.setItem(STORAGE_KEY, JSON.stringify([signature, ...seen].slice(0, 20)))
  return true
}