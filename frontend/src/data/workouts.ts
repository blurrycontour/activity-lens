export type WorkoutType = 'Run' | 'Ride' | 'Hike' | 'Swim' | 'Strength'

export interface HeartRatePoint { t: number; hr: number }
export interface PacePoint { t: number; pace: number }
export interface ElevPoint { t: number; elev: number }

export interface Workout {
  id: string
  name: string
  type: WorkoutType
  date: string
  duration: number // seconds
  distance: number // meters
  avgHR: number
  maxHR: number
  elevationGain: number // meters
  calories: number
  steps?: number
  caloriesManual?: boolean
  stepsManual?: boolean
  avgPace: number // seconds per km (for runs/hikes)
  avgSpeed: number // km/h
  route: Array<[number, number]> // [lat, lng]
  hrTimeline: HeartRatePoint[]
  paceTimeline: PacePoint[]
  elevTimeline: ElevPoint[]
  notes?: string
  equipment?: { id: string; name: string; type: string }[]
}

export const WORKOUT_TYPES: WorkoutType[] = ['Run', 'Ride', 'Hike', 'Swim', 'Strength']

export function fmtDuration(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.round(s % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

export function fmtPace(secPerKm: number): string {
  if (!secPerKm) return '—'
  const m = Math.floor(secPerKm / 60)
  const s = Math.round(secPerKm % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function fmtDist(m: number): string {
  if (m === 0) return '—'
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`
  return `${Math.round(m)} m`
}

export const TYPE_COLOR: Record<WorkoutType, string> = {
  Run: 'var(--run)',
  Ride: 'var(--ride)',
  Hike: 'var(--hike)',
  Swim: 'var(--swim)',
  Strength: 'var(--strength)',
}

export const TYPE_ICON: Record<WorkoutType, string> = {
  Run: '🏃',
  Ride: '🚴',
  Hike: '🥾',
  Swim: '🏊',
  Strength: '🏋️',
}
