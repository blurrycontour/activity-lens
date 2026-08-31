// Dashboard display preferences: which stat cards to show and over what time
// window. Persisted client-side in localStorage (a pure UI concern) and shared
// between the Dashboard and Settings pages via the useLocalStorage hook.

import { RANGE_OPTIONS } from './range'
import { MOBILE_QUERY } from './useIsMobile'

export type StatCardId = 'distance' | 'time' | 'elevation' | 'calories' | 'avgHr' | 'activities'

/**
 * How the dashboard's goals card is drawn. Every style renders the same
 * numbers — this is presentation, not a different measurement — so switching
 * never changes what a goal means or what the notifiers do with it.
 */
export type GoalStyle = 'standard' | 'rings' | 'ledger' | 'today'

export const GOAL_STYLES: { id: GoalStyle; label: string; blurb: string }[] = [
  { id: 'standard', label: 'Standard', blurb: 'Figure, pace and history for each goal.' },
  { id: 'rings', label: 'Rings', blurb: 'One dial per goal, readable at a glance.' },
  { id: 'ledger', label: 'Ledger', blurb: 'A compact list. Best for many goals.' },
  { id: 'today', label: "Today's move", blurb: 'The one thing that would keep you on track.' },
]

/**
 * Reads a stored style, folding away the two that merged.
 *
 * Classic and Pace ended up differing only in where the figure sat: both grew
 * the same needle, verdict, badges and history, so they were one style with a
 * preference rather than two. Anyone who had picked either lands on Standard.
 */
export function resolveGoalStyle(stored: string | undefined): GoalStyle {
  if (stored === 'rings' || stored === 'ledger' || stored === 'today') return stored
  return 'standard'
}

export interface DashboardConfig {
  cards: StatCardId[]
  windowDays: number // 0 = all time
  /** Show period-on-period change under each stat card. */
  showDeltas?: boolean
  /** Show the 8-bucket trend line inside each stat card. */
  showSparklines?: boolean
  /** How the goals card draws each goal. */
  goalStyle?: GoalStyle
  /** Show the run of recent windows under each goal. */
  showGoalHistory?: boolean
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

/** Whether series charts mark their min and max points with a small triangle.
    Two keys — the workout page draws one series per chart, the Analysis page
    stacks several on one — so each is turned on or off on its own. */
export const CHART_PEAKS_WORKOUT_KEY = 'al_chart_peaks_workout'
export const CHART_PEAKS_ANALYSIS_KEY = 'al_chart_peaks_analysis'
export const DEFAULT_CHART_PEAKS = true

export const DASHBOARD_CFG_KEY = 'al_dash_cfg'

/**
 * The stat cards a phone starts with.
 *
 * Six cards on a phone is three rows of tiles above everything the dashboard is
 * actually for. These four are the ones that mean something on every activity;
 * elevation is zero for a treadmill and calories are an estimate, so they are
 * the two to earn their place by being switched on.
 */
export const MOBILE_DEFAULT_CARDS: StatCardId[] = ['distance', 'time', 'avgHr', 'calories']

export const DEFAULT_DASHBOARD_CONFIG: DashboardConfig = {
  cards: STAT_CARDS.map(c => c.id),
  windowDays: 30,
  showDeltas: true,
  showSparklines: true,
  goalStyle: 'standard',
  showGoalHistory: true,
  showGoalPeriods: false,
}

/**
 * The configuration a device starts with, before the user has changed anything.
 *
 * Phone-sized screens get the shorter card list. This can key off the current
 * viewport precisely because the config is stored per device — a phone and a
 * desktop each keep their own, so seeding them differently is right rather than
 * a guess that one of them has to live with. Once saved, the stored value wins
 * and nothing here applies again.
 */
export function defaultDashboardConfig(): DashboardConfig {
  // Via globalThis, which is `window` in a browser: the same call in production
  // and one a test can stub without standing up a DOM. Called as a property so
  // `this` stays the global, which matchMedia requires.
  const narrow = typeof globalThis.matchMedia === 'function'
    && globalThis.matchMedia(MOBILE_QUERY).matches
  if (!narrow) return DEFAULT_DASHBOARD_CONFIG
  return { ...DEFAULT_DASHBOARD_CONFIG, cards: MOBILE_DEFAULT_CARDS }
}

export { rangeLabel as windowLabel } from './range'
