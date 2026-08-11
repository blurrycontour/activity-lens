import { useMemo } from 'react'
import { Activity, Heart, Sparkles } from 'lucide-react'
import Dropdown from './Dropdown'
import { hrZoneBuckets, hrZoneColor } from '../lib/hrZones'
import { FIELD_H, FIELD_W, buildConstellation, normalise } from '../lib/constellation'
import { fmtDuration, type CadencePoint, type HeartRatePoint, type Pause } from '../data/workouts'

/**
 * A workout with no route, drawn as a journey rather than as a chart.
 *
 * The map answers "where did this happen", and a treadmill run, a pool swim or
 * a turbo session has no answer — but it does have a shape, and the shape is
 * what the map was really showing. So the same slot gets a flight path:
 * launching from the lower left, receding toward the upper right, swerving
 * where the effort did, coloured by the same scale the map's track uses.
 *
 * Deliberately not a third view of the heart-rate number. The chart below plots
 * bpm against time and the donut totals the zones; nothing on the page showed
 * the session as one object you could take in at a glance, and the strip of
 * zone colour that used to live here was the same chart drawn shorter.
 *
 * The geometry — which way it curves, where the stars fall, whether there is a
 * planet — is seeded from the workout's id, so every workout gets its own sky
 * and always the same one. See constellation.ts.
 */

export type Tint = 'hr' | 'cadence' | 'none'

interface SessionProfileProps {
  /** Seeds the geometry. The workout's id. */
  id: string
  duration: number
  hrTimeline: HeartRatePoint[]
  cadenceTimeline: CadencePoint[]
  maxHR: number
  pauses: Pause[]
  currentTime: number
  tint: Tint
  onTintChange: (t: Tint) => void
  onScrub: (t: number) => void
}

/** Widest at the launch, finest at the destination: that is the whole illusion. */
function widthAt(depth: number): number {
  return 5.4 - depth * 3.8
}

export default function SessionProfile({
  id, duration, hrTimeline, cadenceTimeline, maxHR, pauses, currentTime,
  tint, onTintChange, onScrub,
}: SessionProfileProps) {
  const hasHR = hrTimeline.length > 1 && maxHR > 0
  const hasCadence = cadenceTimeline.length > 1

  /*
   * The choice, resolved against what this workout actually has.
   *
   * The setting is remembered across workouts, so it will regularly name a
   * scale the workout in front of you cannot offer — heart-rate zones on a
   * session with no heart rate, or with no max HR to measure it against. Falling
   * back here rather than resetting the state means moving to a workout that
   * does have it puts it back, which is what someone who picked it once wants.
   */
  const effective: Tint =
    tint === 'hr' && !hasHR ? (hasCadence ? 'cadence' : 'none')
      : tint === 'cadence' && !hasCadence ? 'none'
        : tint

  /**
   * What bends the path.
   *
   * Heart rate when there is any, whatever the path is coloured by — the
   * swerves are the session's effort, and turning them off with the colour
   * would leave a smooth arc that says nothing. Cadence stands in when there is
   * no heart rate, and a workout with neither gets the bare curve, which is the
   * honest drawing of a workout that recorded nothing.
   */
  const modulation = useMemo(() => {
    if (hrTimeline.length > 1) return normalise(hrTimeline, duration, p => p.t, p => p.hr)
    if (cadenceTimeline.length > 1) return normalise(cadenceTimeline, duration, p => p.t, p => p.cad)
    return []
  }, [hrTimeline, cadenceTimeline, duration])

  const sky = useMemo(() => buildConstellation(id, modulation), [id, modulation])

  /**
   * The path as coloured segments.
   *
   * One <path> per segment rather than one gradient-stroked path: the colour
   * scale is a step function of zones, not a blend, and the stroke also has to
   * taper — neither of which a single stroke can do. Segments are drawn from
   * the far end forward so the near, wider ones overlap the far ones and the
   * recession reads correctly where the path folds over itself.
   */
  const segments = useMemo(() => {
    /*
     * Colours for every segment in one pass over the timeline, with a cursor
     * that only ever moves forward. Looking each one up independently is
     * O(segments × samples), which on an hour of one-second samples is a third
     * of a million comparisons per render — the same trap the map's track
     * shading was written to avoid.
     */
    const useHR = effective === 'hr'
    const useCadence = effective === 'cadence'
    const series: Array<{ t: number }> = useHR ? hrTimeline : useCadence ? cadenceTimeline : []
    const values = useHR ? hrTimeline.map(p => p.hr) : useCadence ? cadenceTimeline.map(p => p.cad) : []
    const min = values.length > 0 ? Math.min(...values) : 0
    const span = values.length > 0 ? Math.max(Math.max(...values) - min, 1) : 1
    let cursor = 0

    const out: Array<{ d: string; color: string; width: number; opacity: number; paused: boolean }> = []
    for (let i = 0; i < sky.points.length - 1; i++) {
      const a = sky.points[i]
      const b = sky.points[i + 1]
      const mid = ((a.t + b.t) / 2) * duration

      let color = 'var(--primary)'
      if (series.length > 0) {
        while (cursor < series.length - 1 && Math.abs(series[cursor + 1].t - mid) <= Math.abs(series[cursor].t - mid)) cursor++
        color = useHR
          ? hrZoneColor(values[cursor], maxHR)
          // The same 210°→20° sweep the map uses for its non-zone shadings.
          : `hsl(${210 - ((values[cursor] - min) / span) * 190} 78% 55%)`
      }

      out.push({
        d: `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} L ${b.x.toFixed(2)} ${b.y.toFixed(2)}`,
        color,
        width: widthAt((a.depth + b.depth) / 2),
        // Fading into the distance, but never to nothing: the destination has
        // to stay findable.
        opacity: 0.95 - ((a.depth + b.depth) / 2) * 0.35,
        // A stretch nothing was recorded through is drawn as a ghost rather
        // than skipped, so the journey stays continuous while the gap shows.
        paused: pauses.some(p => mid >= p.from && mid <= p.to),
      })
    }
    // Drawn far-to-near, so the wider near segments overlap the finer far ones
    // where the path folds back over itself.
    return out.reverse()
  }, [sky, effective, hrTimeline, cadenceTimeline, maxHR, duration, pauses])

  const zones = useMemo(
    () => (hasHR ? hrZoneBuckets(hrTimeline, maxHR).filter(z => z.pct > 0) : []),
    [hasHR, hrTimeline, maxHR],
  )

  const played = duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) : 0
  const here = sky.points[Math.round(played * (sky.points.length - 1))]

  /** A click anywhere on the sky is the moment nearest the pointer's path position. */
  function scrubFrom(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || duration <= 0) return
    // Into the field's own coordinates, then the nearest point on the path.
    const px = ((e.clientX - rect.left) / rect.width) * FIELD_W
    const py = ((e.clientY - rect.top) / rect.height) * FIELD_H
    let best = 0
    let bestD = Infinity
    for (const p of sky.points) {
      const d = (p.x - px) ** 2 + (p.y - py) ** 2
      if (d < bestD) { bestD = d; best = p.t }
    }
    onScrub(best * duration)
  }

  const options = [
    ...(hasHR ? [{ value: 'hr' as Tint, label: 'Heart rate zones', glyph: <Heart size={14} color="var(--text-3)" aria-hidden /> }] : []),
    ...(hasCadence ? [{ value: 'cadence' as Tint, label: 'Cadence', glyph: <Activity size={14} color="var(--text-3)" aria-hidden /> }] : []),
    { value: 'none' as Tint, label: 'Plain', glyph: <Sparkles size={14} color="var(--text-3)" aria-hidden /> },
  ]

  return (
    <div className="session-profile">
      <div className="session-profile-head">
        <Sparkles size={14} style={{ color: 'var(--primary)' }} />
        <h3>The session</h3>
        <span className="session-profile-note">No route recorded</span>
      </div>

      <div className="session-sky">
        <svg
          viewBox={`0 0 ${FIELD_W} ${FIELD_H}`}
          onClick={scrubFrom}
          role="img"
          aria-label="This session drawn as a journey, from its start at the lower left to its finish at the upper right"
        >
          <defs>
            {/* The ground haze: the field's own surface, lifting toward the
                horizon, which is what stops the stars reading as confetti. */}
            <linearGradient id="al-sky" x1="0" y1="1" x2="0.35" y2="0">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.10" />
              <stop offset="55%" stopColor="var(--primary)" stopOpacity="0.02" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
            </linearGradient>
          </defs>

          <rect x="0" y="0" width={FIELD_W} height={FIELD_H} fill="url(#al-sky)" />

          {sky.stars.map((s, i) => (
            <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="var(--text-2)" opacity={s.o} />
          ))}

          {sky.planet && (
            <g opacity="0.22">
              <circle cx={sky.planet.x} cy={sky.planet.y} r={sky.planet.r} fill="var(--text-3)" />
              {sky.planet.ringed && (
                <ellipse
                  cx={sky.planet.x} cy={sky.planet.y}
                  rx={sky.planet.r * 1.85} ry={sky.planet.r * 0.42}
                  fill="none" stroke="var(--text-3)" strokeWidth="1.4"
                  transform={`rotate(-18 ${sky.planet.x} ${sky.planet.y})`}
                />
              )}
            </g>
          )}

          {segments.map((s, i) => (
            <path
              key={i}
              d={s.d}
              stroke={s.paused ? 'var(--text-3)' : s.color}
              strokeWidth={s.paused ? s.width * 0.45 : s.width}
              strokeLinecap="round"
              strokeDasharray={s.paused ? '1 4' : undefined}
              opacity={s.paused ? 0.5 : s.opacity}
              fill="none"
            />
          ))}

          {/* Launch: a filled mark with a ring around it, the biggest thing on
              the path because it is the nearest. */}
          <circle cx={sky.points[0].x} cy={sky.points[0].y} r="4.6" fill="var(--success)" />
          <circle cx={sky.points[0].x} cy={sky.points[0].y} r="8.5" fill="none" stroke="var(--success)" strokeWidth="1.2" opacity="0.5" />

          {/* Destination: a four-point sparkle, small because it is far away. */}
          <Sparkle x={sky.points[sky.points.length - 1].x} y={sky.points[sky.points.length - 1].y} r={7} />

          {/* Where playback has reached. */}
          {here && (
            <g>
              <circle cx={here.x} cy={here.y} r={widthAt(here.depth) * 0.9 + 2.4} fill="var(--text)" opacity="0.16" />
              <circle cx={here.x} cy={here.y} r={widthAt(here.depth) * 0.55 + 1.2} fill="var(--text)" />
            </g>
          )}
        </svg>

        <div className="session-sky-scale">
          <span>0:00</span>
          <span>{fmtDuration(duration)}</span>
        </div>

        {options.length > 1 && (
          <div className="session-sky-picker">
            <Dropdown value={effective} onChange={onTintChange} dropUp ariaLabel="Path colour" options={options} />
          </div>
        )}
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

/** The destination mark: a four-point star, drawn from two crossed lenses. */
function Sparkle({ x, y, r }: { x: number; y: number; r: number }) {
  const d = `M ${x} ${y - r} Q ${x + r * 0.22} ${y - r * 0.22} ${x + r} ${y}`
    + ` Q ${x + r * 0.22} ${y + r * 0.22} ${x} ${y + r}`
    + ` Q ${x - r * 0.22} ${y + r * 0.22} ${x - r} ${y}`
    + ` Q ${x - r * 0.22} ${y - r * 0.22} ${x} ${y - r} Z`
  return <path d={d} fill="var(--warning)" />
}

/** Whether there is enough for the drawing to be about this workout. */
export function canProfile(duration: number, hrTimeline: HeartRatePoint[], cadenceTimeline: CadencePoint[]): boolean {
  return duration > 0 && (hrTimeline.length > 1 || cadenceTimeline.length > 1)
}
