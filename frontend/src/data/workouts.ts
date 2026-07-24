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
  avgPace: number // seconds per km (for runs/hikes)
  avgSpeed: number // km/h
  route: Array<[number, number]> // [lat, lng]
  hrTimeline: HeartRatePoint[]
  paceTimeline: PacePoint[]
  elevTimeline: ElevPoint[]
  notes?: string
}

function mkRoute(lat: number, lng: number, loops: number, radius: number): Array<[number, number]> {
  const pts: Array<[number, number]> = []
  const steps = 60
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2 * loops
    const r = radius * (1 + 0.2 * Math.sin(t * 3.7))
    pts.push([lat + r * Math.cos(t) + 0.002 * Math.sin(i * 0.4), lng + r * Math.sin(t) * 1.4 + 0.001 * Math.cos(i * 0.6)])
  }
  return pts
}

function mkHR(duration: number, base: number, max: number): HeartRatePoint[] {
  const pts: HeartRatePoint[] = []
  const steps = Math.min(120, Math.floor(duration / 30))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const warmup = t < 0.1 ? t / 0.1 : 1
    const effort = base + (max - base) * warmup * (0.7 + 0.3 * Math.sin(t * 8 + 1))
    pts.push({ t: Math.round(i * (duration / steps)), hr: Math.round(effort + Math.random() * 6 - 3) })
  }
  return pts
}

function mkPace(duration: number, avgPace: number): PacePoint[] {
  const pts: PacePoint[] = []
  const steps = Math.min(80, Math.floor(duration / 45))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const variation = avgPace * (0.85 + 0.3 * Math.abs(Math.sin(t * 5.3)) + 0.1 * Math.sin(t * 12))
    pts.push({ t: Math.round(i * (duration / steps)), pace: Math.round(variation) })
  }
  return pts
}

function mkElev(duration: number, gain: number): ElevPoint[] {
  const pts: ElevPoint[] = []
  const steps = 60
  let elev = 120
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    elev += (gain / steps) * (Math.sin(t * Math.PI) + 0.3 * Math.random() - 0.15)
    pts.push({ t: Math.round(i * (duration / steps)), elev: Math.round(elev) })
  }
  return pts
}

function dateStr(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().split('T')[0]
}

const runNames = ['Morning Tempo Run', 'Easy Recovery Jog', 'Threshold Intervals', 'Long Sunday Run', 'Fartlek Session', 'Lunch Break Run', 'Evening 5K', 'Pre-race Shakeout', 'Hill Repeats', 'Track Workout', 'Progression Run', 'Base Building Run']
const rideNames = ['Century Prep Ride', 'Gravel Loop', 'Criterium Training', 'Climbing Day', 'Recovery Spin', 'Endurance Ride', 'City Commute', 'Group Ride', 'Power Intervals', 'Long Gravel Grind']
const hikeNames = ['Summit Day', 'Trail Exploration', 'Mountain Loop', 'Ridge Walk', 'Valley Hike', 'Dawn Patrol', 'Sunrise Trek']
const swimNames = ['Masters Swim', 'Open Water', 'Drill Session', 'Distance Set']
const strengthNames = ['Upper Body', 'Leg Day', 'Core Circuit', 'Full Body HIIT', 'Mobility Work']

const raw: Array<Omit<Workout, 'route' | 'hrTimeline' | 'paceTimeline' | 'elevTimeline'> & { lat: number; lng: number; loopR: number }> = [
  { id: 'w1', name: runNames[0], type: 'Run', date: dateStr(1), duration: 2880, distance: 8400, avgHR: 158, maxHR: 176, elevationGain: 72, calories: 520, avgPace: 343, avgSpeed: 10.5, lat: 47.605, lng: -122.334, loopR: 0.018 },
  { id: 'w2', name: rideNames[0], type: 'Ride', date: dateStr(3), duration: 10800, distance: 62000, avgHR: 142, maxHR: 168, elevationGain: 820, calories: 1420, avgPace: 0, avgSpeed: 20.7, lat: 47.612, lng: -122.345, loopR: 0.06 },
  { id: 'w3', name: hikeNames[0], type: 'Hike', date: dateStr(5), duration: 14400, distance: 18000, avgHR: 128, maxHR: 155, elevationGain: 1240, calories: 980, avgPace: 800, avgSpeed: 4.5, lat: 47.58, lng: -121.9, loopR: 0.04 },
  { id: 'w4', name: runNames[3], type: 'Run', date: dateStr(8), duration: 5400, distance: 16200, avgHR: 152, maxHR: 171, elevationGain: 118, calories: 890, avgPace: 333, avgSpeed: 10.8, lat: 47.601, lng: -122.33, loopR: 0.032 },
  { id: 'w5', name: rideNames[4], type: 'Ride', date: dateStr(10), duration: 3600, distance: 22000, avgHR: 118, maxHR: 138, elevationGain: 210, calories: 520, avgPace: 0, avgSpeed: 22.0, lat: 47.614, lng: -122.35, loopR: 0.024 },
  { id: 'w6', name: swimNames[0], type: 'Swim', date: dateStr(11), duration: 2700, distance: 2000, avgHR: 138, maxHR: 158, elevationGain: 0, calories: 380, avgPace: 0, avgSpeed: 2.7, lat: 47.608, lng: -122.34, loopR: 0.008 },
  { id: 'w7', name: strengthNames[1], type: 'Strength', date: dateStr(12), duration: 3600, distance: 0, avgHR: 122, maxHR: 148, elevationGain: 0, calories: 340, avgPace: 0, avgSpeed: 0, lat: 47.605, lng: -122.336, loopR: 0 },
  { id: 'w8', name: runNames[2], type: 'Run', date: dateStr(14), duration: 4200, distance: 11200, avgHR: 168, maxHR: 184, elevationGain: 85, calories: 720, avgPace: 375, avgSpeed: 9.6, lat: 47.602, lng: -122.337, loopR: 0.022 },
  { id: 'w9', name: rideNames[1], type: 'Ride', date: dateStr(16), duration: 7200, distance: 42000, avgHR: 147, maxHR: 165, elevationGain: 560, calories: 980, avgPace: 0, avgSpeed: 21.0, lat: 47.618, lng: -122.36, loopR: 0.048 },
  { id: 'w10', name: hikeNames[1], type: 'Hike', date: dateStr(19), duration: 10800, distance: 14000, avgHR: 122, maxHR: 148, elevationGain: 680, calories: 720, avgPace: 770, avgSpeed: 4.7, lat: 47.59, lng: -121.88, loopR: 0.032 },
  { id: 'w11', name: runNames[10], type: 'Run', date: dateStr(21), duration: 3000, distance: 7500, avgHR: 155, maxHR: 174, elevationGain: 60, calories: 480, avgPace: 400, avgSpeed: 9.0, lat: 47.604, lng: -122.332, loopR: 0.016 },
  { id: 'w12', name: swimNames[2], type: 'Swim', date: dateStr(22), duration: 3600, distance: 2800, avgHR: 142, maxHR: 162, elevationGain: 0, calories: 490, avgPace: 0, avgSpeed: 2.8, lat: 47.608, lng: -122.34, loopR: 0.009 },
  { id: 'w13', name: rideNames[8], type: 'Ride', date: dateStr(24), duration: 4800, distance: 32000, avgHR: 161, maxHR: 179, elevationGain: 420, calories: 820, avgPace: 0, avgSpeed: 24.0, lat: 47.611, lng: -122.348, loopR: 0.038 },
  { id: 'w14', name: runNames[8], type: 'Run', date: dateStr(25), duration: 2400, distance: 6000, avgHR: 162, maxHR: 180, elevationGain: 140, calories: 410, avgPace: 400, avgSpeed: 9.0, lat: 47.607, lng: -122.343, loopR: 0.014 },
  { id: 'w15', name: strengthNames[0], type: 'Strength', date: dateStr(26), duration: 2700, distance: 0, avgHR: 118, maxHR: 142, elevationGain: 0, calories: 280, avgPace: 0, avgSpeed: 0, lat: 47.605, lng: -122.336, loopR: 0 },
  { id: 'w16', name: runNames[9], type: 'Run', date: dateStr(28), duration: 5400, distance: 15000, avgHR: 172, maxHR: 188, elevationGain: 55, calories: 940, avgPace: 360, avgSpeed: 10.0, lat: 47.603, lng: -122.33, loopR: 0.028 },
  { id: 'w17', name: rideNames[2], type: 'Ride', date: dateStr(31), duration: 5400, distance: 36000, avgHR: 158, maxHR: 174, elevationGain: 390, calories: 840, avgPace: 0, avgSpeed: 24.0, lat: 47.616, lng: -122.352, loopR: 0.042 },
  { id: 'w18', name: hikeNames[5], type: 'Hike', date: dateStr(33), duration: 7200, distance: 10000, avgHR: 118, maxHR: 142, elevationGain: 480, calories: 580, avgPace: 720, avgSpeed: 5.0, lat: 47.588, lng: -121.92, loopR: 0.025 },
  { id: 'w19', name: runNames[5], type: 'Run', date: dateStr(35), duration: 1800, distance: 5000, avgHR: 148, maxHR: 168, elevationGain: 30, calories: 320, avgPace: 360, avgSpeed: 10.0, lat: 47.602, lng: -122.335, loopR: 0.012 },
  { id: 'w20', name: swimNames[3], type: 'Swim', date: dateStr(36), duration: 4500, distance: 3500, avgHR: 145, maxHR: 165, elevationGain: 0, calories: 610, avgPace: 0, avgSpeed: 2.8, lat: 47.608, lng: -122.34, loopR: 0.01 },
  { id: 'w21', name: runNames[4], type: 'Run', date: dateStr(38), duration: 3600, distance: 9500, avgHR: 156, maxHR: 176, elevationGain: 68, calories: 610, avgPace: 379, avgSpeed: 9.5, lat: 47.604, lng: -122.332, loopR: 0.02 },
  { id: 'w22', name: rideNames[3], type: 'Ride', date: dateStr(40), duration: 9000, distance: 58000, avgHR: 148, maxHR: 172, elevationGain: 1120, calories: 1280, avgPace: 0, avgSpeed: 23.2, lat: 47.62, lng: -122.36, loopR: 0.065 },
  { id: 'w23', name: strengthNames[3], type: 'Strength', date: dateStr(42), duration: 2400, distance: 0, avgHR: 132, maxHR: 162, elevationGain: 0, calories: 320, avgPace: 0, avgSpeed: 0, lat: 47.605, lng: -122.336, loopR: 0 },
  { id: 'w24', name: runNames[1], type: 'Run', date: dateStr(43), duration: 2700, distance: 7200, avgHR: 138, maxHR: 155, elevationGain: 45, calories: 440, avgPace: 375, avgSpeed: 9.6, lat: 47.603, lng: -122.334, loopR: 0.015 },
  { id: 'w25', name: hikeNames[2], type: 'Hike', date: dateStr(46), duration: 18000, distance: 24000, avgHR: 132, maxHR: 158, elevationGain: 1680, calories: 1240, avgPace: 750, avgSpeed: 4.8, lat: 47.57, lng: -121.86, loopR: 0.055 },
  { id: 'w26', name: rideNames[9], type: 'Ride', date: dateStr(48), duration: 14400, distance: 98000, avgHR: 144, maxHR: 168, elevationGain: 1420, calories: 2100, avgPace: 0, avgSpeed: 24.5, lat: 47.63, lng: -122.38, loopR: 0.1 },
  { id: 'w27', name: runNames[6], type: 'Run', date: dateStr(50), duration: 1620, distance: 5000, avgHR: 162, maxHR: 182, elevationGain: 22, calories: 320, avgPace: 324, avgSpeed: 11.1, lat: 47.605, lng: -122.338, loopR: 0.012 },
  { id: 'w28', name: swimNames[1], type: 'Swim', date: dateStr(51), duration: 3600, distance: 2200, avgHR: 140, maxHR: 158, elevationGain: 0, calories: 420, avgPace: 0, avgSpeed: 2.2, lat: 47.608, lng: -122.34, loopR: 0.009 },
  { id: 'w29', name: runNames[11], type: 'Run', date: dateStr(53), duration: 4200, distance: 12000, avgHR: 148, maxHR: 168, elevationGain: 88, calories: 760, avgPace: 350, avgSpeed: 10.3, lat: 47.601, lng: -122.33, loopR: 0.026 },
  { id: 'w30', name: rideNames[5], type: 'Ride', date: dateStr(56), duration: 10800, distance: 72000, avgHR: 138, maxHR: 162, elevationGain: 720, calories: 1580, avgPace: 0, avgSpeed: 24.0, lat: 47.615, lng: -122.355, loopR: 0.075 },
  { id: 'w31', name: hikeNames[6], type: 'Hike', date: dateStr(58), duration: 9000, distance: 12000, avgHR: 125, maxHR: 150, elevationGain: 820, calories: 680, avgPace: 750, avgSpeed: 4.8, lat: 47.585, lng: -121.94, loopR: 0.028 },
  { id: 'w32', name: runNames[0], type: 'Run', date: dateStr(60), duration: 2520, distance: 7000, avgHR: 155, maxHR: 172, elevationGain: 52, calories: 445, avgPace: 360, avgSpeed: 10.0, lat: 47.603, lng: -122.335, loopR: 0.015 },
  { id: 'w33', name: strengthNames[2], type: 'Strength', date: dateStr(62), duration: 3000, distance: 0, avgHR: 128, maxHR: 155, elevationGain: 0, calories: 310, avgPace: 0, avgSpeed: 0, lat: 47.605, lng: -122.336, loopR: 0 },
  { id: 'w34', name: rideNames[6], type: 'Ride', date: dateStr(63), duration: 2700, distance: 18000, avgHR: 128, maxHR: 148, elevationGain: 180, calories: 420, avgPace: 0, avgSpeed: 24.0, lat: 47.608, lng: -122.34, loopR: 0.022 },
  { id: 'w35', name: runNames[7], type: 'Run', date: dateStr(65), duration: 1800, distance: 5000, avgHR: 140, maxHR: 158, elevationGain: 18, calories: 285, avgPace: 360, avgSpeed: 10.0, lat: 47.604, lng: -122.336, loopR: 0.012 },
  { id: 'w36', name: runNames[3], type: 'Run', date: dateStr(68), duration: 6300, distance: 18000, avgHR: 155, maxHR: 174, elevationGain: 130, calories: 1080, avgPace: 350, avgSpeed: 10.3, lat: 47.6, lng: -122.33, loopR: 0.036 },
  { id: 'w37', name: rideNames[7], type: 'Ride', date: dateStr(70), duration: 7200, distance: 50000, avgHR: 145, maxHR: 168, elevationGain: 620, calories: 1080, avgPace: 0, avgSpeed: 25.0, lat: 47.617, lng: -122.358, loopR: 0.056 },
  { id: 'w38', name: hikeNames[3], type: 'Hike', date: dateStr(74), duration: 12600, distance: 16000, avgHR: 130, maxHR: 155, elevationGain: 1080, calories: 860, avgPace: 788, avgSpeed: 4.6, lat: 47.576, lng: -121.85, loopR: 0.038 },
  { id: 'w39', name: swimNames[0], type: 'Swim', date: dateStr(76), duration: 2700, distance: 2000, avgHR: 135, maxHR: 155, elevationGain: 0, calories: 365, avgPace: 0, avgSpeed: 2.7, lat: 47.608, lng: -122.34, loopR: 0.008 },
  { id: 'w40', name: runNames[2], type: 'Run', date: dateStr(78), duration: 3900, distance: 10400, avgHR: 166, maxHR: 186, elevationGain: 78, calories: 670, avgPace: 375, avgSpeed: 9.6, lat: 47.604, lng: -122.337, loopR: 0.021 },
]

export const workouts: Workout[] = raw.map(({ lat, lng, loopR, ...w }) => ({
  ...w,
  route: loopR > 0 ? mkRoute(lat, lng, 1.5, loopR) : [[lat, lng]],
  hrTimeline: mkHR(w.duration, w.avgHR - 20, w.maxHR),
  paceTimeline: w.type === 'Run' || w.type === 'Hike' ? mkPace(w.duration, w.avgPace) : [],
  elevTimeline: mkElev(w.duration, w.elevationGain),
}))

export function fmtDuration(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

export function fmtPace(secPerKm: number): string {
  if (!secPerKm) return '—'
  const m = Math.floor(secPerKm / 60)
  const s = secPerKm % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function fmtDist(m: number): string {
  if (m === 0) return '—'
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`
  return `${m} m`
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
