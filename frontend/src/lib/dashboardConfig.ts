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

export { RANGE_OPTIONS as WINDOW_OPTIONS } from './range'

/** How the workout page draws the heart-rate zone breakdown. */
export type HRZoneChart = 'histogram' | 'pie'
export const HR_ZONE_CHART_KEY = 'al_hrzone_chart'
export const DEFAULT_HR_ZONE_CHART: HRZoneChart = 'histogram'

export const DASHBOARD_CFG_KEY = 'al_dash_cfg'

export const DEFAULT_DASHBOARD_CONFIG: DashboardConfig = {
  cards: STAT_CARDS.map(c => c.id),
  windowDays: 30,
}

export { rangeLabel as windowLabel } from './range'
