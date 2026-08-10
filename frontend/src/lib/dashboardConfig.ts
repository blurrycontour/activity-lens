// Dashboard display preferences: which stat cards to show and over what time
// window. Persisted client-side in localStorage (a pure UI concern) and shared
// between the Dashboard and Settings pages via the useLocalStorage hook.

import { RANGE_OPTIONS } from './range'

export type StatCardId = 'distance' | 'time' | 'elevation' | 'calories' | 'avgHr' | 'activities'

export interface DashboardConfig {
  cards: StatCardId[]
  windowDays: number // 0 = all time
  /** Show period-on-period change under each stat card. */
  showDeltas?: boolean
  /** Show the 8-bucket trend line inside each stat card. */
  showSparklines?: boolean
  /** Label each bar under the goal history with its week number or month. */
  showGoalPeriods?: boolean
}

export const STAT_CARDS: { id: StatCardId; label: string }[] = [
  { id: 'distance', label: 'Total Distance' },
  { id: 'time', label: 'Total Time' },
  { id: 'elevation', label: 'Elevation' },
  { id: 'calories', label: 'Calories' },
  { id: 'avgHr', label: 'Avg Heart Rate' },
  { id: 'activities', label: 'Activities' },
]

/**
 * Periods the dashboard totals can cover: the shared ranges plus a fortnight.
 *
 * Two weeks is worth having here and nowhere else — it is the span a training
 * block is judged over, and the dashboard is the only place asking "how am I
 * doing lately". The filter dropdowns elsewhere stay as they are; a longer
 * list of near-identical options costs more there than it gains.
 */
const FORTNIGHT = { value: 14, label: 'Last 14 days', short: '14d' }
export const WINDOW_OPTIONS = RANGE_OPTIONS.flatMap(
  o => (o.value === 30 ? [FORTNIGHT, o] : [o]),
)

/** How the workout page draws the heart-rate zone breakdown. */
export type HRZoneChart = 'histogram' | 'pie'
export const HR_ZONE_CHART_KEY = 'al_hrzone_chart'
export const DEFAULT_HR_ZONE_CHART: HRZoneChart = 'histogram'

export const DASHBOARD_CFG_KEY = 'al_dash_cfg'

export const DEFAULT_DASHBOARD_CONFIG: DashboardConfig = {
  cards: STAT_CARDS.map(c => c.id),
  windowDays: 30,
  showDeltas: true,
  showSparklines: true,
}

export { rangeLabel as windowLabel } from './range'
