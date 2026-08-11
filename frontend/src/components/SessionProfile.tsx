import { useMemo } from 'react'
import { Activity } from 'lucide-react'
import { hrZoneBuckets, hrZoneColor } from '../lib/hrZones'
import { fmtDuration, type HeartRatePoint, type Pause } from '../data/workouts'

/**
 * The shape of a session, for a workout with no route to draw.
 *
 * The map answers "where did this happen", and a treadmill run, a pool swim or
 * a turbo session has no answer to that — but every one of them can answer
 * "how hard, and when", which is the question the map was standing in for
 * anyway. So the same slot gets a band of the workout's whole duration,
 * coloured by heart-rate zone, with the recording gaps cut out of it.
 *
 * It is not a second heart-rate chart. The chart below plots bpm against time
 * and is read by following a line; this is read at a glance — where the hard
 * parts were, how many there were, how long the easy stretch in the middle
 * lasted. Hence a band of colour rather than a line, and time-in-zone
 * underneath rather than min/avg/max.
 *
 * Scrubbable, like the map it stands in for, so the charts below still follow
 * the same cursor.
 */

/** Slices the band is drawn from. More is smoother and costs nothing here. */
const SEGMENTS = 160

interface SessionProfileProps {
  duration: number
  hrTimeline: HeartRatePoint[]
  maxHR: number
  pauses: Pause[]
  currentTime: number
  onScrub: (t: number) => void
}

export default function SessionProfile({
  duration, hrTimeline, maxHR, pauses, currentTime, onScrub,
}: SessionProfileProps) {
  /**
   * The band, as one CSS gradient with hard stops.
   *
   * A gradient and not 160 elements: this is a single node the browser paints
   * in one go, where the element-per-slice version was a flex container the
   * layout engine had to measure on every resize of a panel that is already the
   * widest thing on the page.
   *
   * The colours come from the sample nearest each slice's midpoint, found by
   * walking a cursor through the timeline rather than searching per slice —
   * the same reason the map's track shading is capped and stepped.
   */
  const band = useMemo(() => {
    if (duration <= 0 || hrTimeline.length === 0) return null
    const width = duration / SEGMENTS
    let cursor = 0
    const stops: string[] = []
    for (let i = 0; i < SEGMENTS; i++) {
      const t = (i + 0.5) * width
      while (cursor < hrTimeline.length - 1 && Math.abs(hrTimeline[cursor + 1].t - t) <= Math.abs(hrTimeline[cursor].t - t)) cursor++
      // A slice inside a pause is drawn as a gap. Painting it the colour of the
      // sample either side would invent an effort that never happened, and the
      // gaps are half of what the band is for.
      const paused = pauses.some(p => t >= p.from && t <= p.to)
      const color = paused ? 'var(--bg-3)' : hrZoneColor(hrTimeline[cursor].hr, maxHR)
      const from = ((i / SEGMENTS) * 100).toFixed(3)
      const to = (((i + 1) / SEGMENTS) * 100).toFixed(3)
      stops.push(`${color} ${from}%`, `${color} ${to}%`)
    }
    return `linear-gradient(to right, ${stops.join(',')})`
  }, [duration, hrTimeline, maxHR, pauses])

  const zones = useMemo(
    () => hrZoneBuckets(hrTimeline, maxHR).filter(z => z.pct > 0),
    [hrTimeline, maxHR],
  )

  const played = duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) : 0

  /** Turns a click anywhere on the band into the moment under the pointer. */
  function scrubFrom(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || duration <= 0) return
    onScrub(Math.max(0, Math.min(duration, ((e.clientX - rect.left) / rect.width) * duration)))
  }

  return (
    <div className="session-profile">
      <div className="session-profile-head">
        <Activity size={14} style={{ color: 'var(--danger)' }} />
        <h3>Effort</h3>
        <span className="session-profile-note">No route recorded</span>
      </div>

      <div
        className="session-ribbon"
        style={band ? { backgroundImage: band } : undefined}
        onClick={scrubFrom}
        role="presentation"
        title="Click to move the playhead"
      >
        {/* Over the band rather than part of it, so moving it repaints one
            element instead of rebuilding the gradient. */}
        <span className="session-ribbon-cursor" style={{ left: `${played * 100}%` }} />
      </div>

      <div className="session-ribbon-scale">
        <span>0:00</span>
        <span>{fmtDuration(duration)}</span>
      </div>

      {zones.length > 0 && (
        <ul className="session-zones">
          {zones.map(z => (
            <li key={z.short}>
              <span className="session-zone-key">
                <i style={{ background: z.color }} />
                {z.short}
              </span>
              <span className="session-zone-bar">
                <i style={{ width: `${z.pct}%`, background: z.color }} />
              </span>
              <span className="session-zone-pct">{z.pct}%</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Whether there is enough recorded for the profile to say anything. */
export function canProfile(duration: number, hrTimeline: HeartRatePoint[]): boolean {
  return duration > 0 && hrTimeline.length > 1
}
