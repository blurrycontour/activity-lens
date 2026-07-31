export type WorkoutType = 'Run' | 'Ride' | 'Hike' | 'Swim' | 'Strength'

export interface HeartRatePoint { t: number; hr: number }
export interface PacePoint { t: number; pace: number }
export interface ElevPoint { t: number; elev: number }
/** Steps per minute for foot-based activities, rpm for rides. */
export interface CadencePoint { t: number; cad: number }

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
  /**
   * How this workout got here: 'upload' for a file the user picked, 'manual'
   * for hand entry, 'autoimport' for the Android folder watch. Absent on older
   * rows, which predate the field.
   */
  source?: 'upload' | 'manual' | 'healthconnect' | 'autoimport'
  /**
   * When this workout entered the library, RFC 3339 — not when it happened. An
   * import can bring in a run from years ago, so this is the only field that
   * answers "what just arrived".
   */
  createdAt?: string
  caloriesManual?: boolean
  /** Calories stated by the imported file itself rather than estimated by us. */
  caloriesReported?: boolean
  stepsManual?: boolean
  avgPace: number // seconds per km (for runs/hikes)
  avgSpeed: number // km/h
  route: Array<[number, number]> // [lat, lng]
  hrTimeline: HeartRatePoint[]
  paceTimeline: PacePoint[]
  elevTimeline: ElevPoint[]
  cadenceTimeline?: CadencePoint[]
  notes?: string
  equipment?: { id: string; name: string; type: string }[]
  /** Sharing state. Present on your own workouts only. */
  visibility?: 'private' | 'public'
  /** How many people this workout is shared with directly. Your own only. */
  sharedWithCount?: number
  /** The author, present only on workouts belonging to someone else. */
  owner?: { id: number; username: string; displayName: string; avatarPath: string }
  /**
   * Whether the signed-in user owns this workout. Only single-workout
   * responses carry it; list rows are unambiguous (your library is all yours,
   * a feed is all someone else's).
   */
  isOwner?: boolean
  /**
   * Whether the file this workout was imported from was archived and can be
   * downloaded. Only true on your own workouts, and only when the server was
   * keeping originals at the time of the import.
   */
  hasOriginal?: boolean
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
