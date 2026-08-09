import { Bike, CircleDashed, Dumbbell, Mountain, SportShoe, Waves, type LucideIcon } from 'lucide-react'

/**
 * `Other` is where an import lands when the file declares no sport and its free
 * text names none. It is not something a person picks — see WORKOUT_TYPES.
 */
export type WorkoutType = 'Run' | 'Ride' | 'Hike' | 'Swim' | 'Strength' | 'Other'

export interface HeartRatePoint { t: number; hr: number }
export interface PacePoint { t: number; pace: number }
export interface ElevPoint { t: number; elev: number }
/** Steps per minute for foot-based activities, rpm for rides. */
export interface CadencePoint { t: number; cad: number }

/** Conditions over the span of a workout. See backend/internal/weather. */
export interface Weather {
  tempC: number
  apparentC: number
  /** Relative humidity, 0-100. */
  humidity: number
  windKph: number
  /** Total that fell during the workout, not a rate. */
  precipMm: number
  /** WMO weather code, driving the icon and label. */
  code: number
}

/**
 * A library tallied by weather status, for the settings page.
 *
 * `recorded` folds looked-up and hand-entered together — from the outside a
 * workout either has conditions on it or does not — with `manual` naming the
 * subset that a lookup will never touch.
 */
export interface WeatherCounts {
  recorded: number
  manual: number
  /** Queued, including anything held back by Open-Meteo rate limiting us. */
  scheduled: number
  /** Out of retries. Only an explicit retry moves these. */
  failed: number
  /** Indoor, or no GPS: can never have weather. */
  skipped: number
  /** Predates the feature; only ever queued by an explicit backfill. */
  unchecked: number
}

/**
 * Why a workout has no weather.
 *
 * 'none'    never checked — everything that predates the feature, until the
 *           user asks for a backfill
 * 'pending' queued for the background lookup
 * 'ok'      fetched
 * 'manual'  typed in by hand; never overwritten by a lookup
 * 'skipped' impossible: no GPS, indoors, or a nonsense coordinate
 * 'failed'  tried and could not — distinct from never having looked
 */
export type WeatherStatus = 'none' | 'pending' | 'ok' | 'manual' | 'skipped' | 'failed'

export interface Workout {
  id: string
  name: string
  type: WorkoutType
  date: string
  /**
   * The instant the workout began, RFC 3339 — `date` with the time of day still
   * on it. Optional because a server older than this field simply omits it, and
   * everything that wants a time of day has to cope with not having one.
   */
  startTime?: string
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
  /**
   * Conditions this workout happened in, or absent when we do not know.
   *
   * Absence is meaningful and is the only honest representation: every column
   * behind this is stored NOT NULL DEFAULT 0, so a workout nobody looked up
   * would otherwise arrive as a confident 0 °C on a clear, still day. The
   * server only sends this when it has a real reading.
   */
  weather?: Weather
  /** Why `weather` is missing, so the UI can say something more useful than nothing. */
  weatherStatus?: WeatherStatus
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

/**
 * The sports a person can choose.
 *
 * `Other` is absent on purpose. It exists so an import that could not be
 * classified has an honest answer, and a bucket people can pick fills up with
 * things that had a real one. It still renders everywhere a type is displayed —
 * see TYPE_COLOR and TYPE_ICON, which cover every member of the union.
 */
export const WORKOUT_TYPES: WorkoutType[] = ['Run', 'Ride', 'Hike', 'Swim', 'Strength']

/** Every type that can appear on a workout, including the unpickable one. */
export const ALL_WORKOUT_TYPES: WorkoutType[] = [...WORKOUT_TYPES, 'Other']

export function fmtDuration(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.round(s % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

/**
 * Elapsed seconds as h:mm, for a time axis and its tooltip.
 *
 * Minutes alone stopped reading as a time somewhere around "97m": a long hike's
 * axis was a row of three-digit numbers nobody converts in their head. Hours
 * are not padded, so a short workout gets "0:05" rather than "00:05" — the
 * shape of a clock, at the length the number deserves.
 */
export function fmtClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds / 60))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export function fmtPace(secPerKm: number): string {
  if (!secPerKm) return '—'
  const m = Math.floor(secPerKm / 60)
  const s = Math.round(secPerKm % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * The headline rate for a workout: pace where that is the natural reading,
 * speed where it is not, and nothing at all when neither was measured.
 *
 * The last case is the point. A strength session, or a treadmill run imported
 * without distance, has no rate — and falling through to `avgSpeed.toFixed(1)`
 * stated "0.0 km/h", which reads as a measurement rather than as its absence.
 */
export function fmtRate(w: Pick<Workout, 'avgPace' | 'avgSpeed'>): { value: string; unit: string } {
  if (w.avgPace > 0) return { value: fmtPace(w.avgPace), unit: '/km' }
  if (w.avgSpeed > 0) return { value: w.avgSpeed.toFixed(1), unit: 'km/h' }
  return { value: '—', unit: '' }
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
  Other: 'var(--other)',
}

/**
 * The mark for each sport, as a component rather than an emoji.
 *
 * Emoji render in whatever the platform ships — colour, weight and metrics all
 * differ between Android, iOS and each desktop font — so the same screen looked
 * like a different app depending on where it was opened, and nothing about them
 * followed the accent or the light/dark theme. These are the same stroked
 * lucide icons the rest of the app uses, drawn in the sport's own colour and
 * sized to whatever contains them.
 *
 * Render through `<TypeIcon>` rather than reaching for the component directly;
 * it exists so call sites do not each have to capitalise the lookup to make JSX
 * of it.
 */
export const TYPE_ICON: Record<WorkoutType, LucideIcon> = {
  Run: SportShoe,
  Ride: Bike,
  Hike: Mountain,
  Swim: Waves,
  Strength: Dumbbell,
  // A dashed ring: a shape that reads as "unspecified" rather than as a sport.
  Other: CircleDashed,
}
