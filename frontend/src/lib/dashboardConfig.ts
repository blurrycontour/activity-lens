// Dashboard display preferences: which stat cards to show and over what time
// window. Persisted client-side in localStorage (a pure UI concern) and shared
// between the Dashboard and Settings pages via the useLocalStorage hook.

export type StatCardId = 'distance' | 'time' | 'elevation' | 'calories' | 'avgHr' | 'activities'

export interface DashboardConfig {
  cards: StatCardId[]
  windowDays: number // 0 = all time
}

export const STAT_CARDS: { id: StatCardId; label: string }[] = [
  { id: 'distance', label: 'Total Distance' },
  { id: 'time', label: 'Total Time' },
  { id: 'elevation', label: 'Elevation' },
  { id: 'calories', label: 'Calories' },
  { id: 'avgHr', label: 'Avg Heart Rate' },
  { id: 'activities', label: 'Activities' },
]

export const WINDOW_OPTIONS: { value: number; label: string }[] = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 365, label: 'Last year' },
  { value: 0, label: 'All time' },
]

export const DASHBOARD_CFG_KEY = 'al_dash_cfg'

export const DEFAULT_DASHBOARD_CONFIG: DashboardConfig = {
  cards: STAT_CARDS.map(c => c.id),
  windowDays: 30,
}

/** Human-readable caption for a window, e.g. "last 30 days" or "all time". */
export function windowLabel(days: number): string {
  if (days <= 0) return 'all time'
  if (days === 365) return 'last year'
  return `last ${days} days`
}
