import type { GoalProgress } from './insights'

export function goalsAreComplete(progress: GoalProgress[]): boolean {
  return progress.length > 0 && progress.every(p => p.current >= p.goal.target)
}
