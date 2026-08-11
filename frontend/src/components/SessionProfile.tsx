import { useId, useMemo } from 'react'
import { Activity, Heart, Maximize2, Sparkles } from 'lucide-react'
import Dropdown from './Dropdown'
import { HR_ZONE_COLORS, HR_ZONE_SHORT, hrZoneColor } from '../lib/hrZones'
import { FIELD_H, FIELD_W, buildConstellation, normalise, pointAt } from '../lib/constellation'
import type { CadencePoint, HeartRatePoint, Pause } from '../data/workouts'

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

/**
 * The two shapes a colour key takes, spelled out as a union rather than one
 * object with everything optional — `'zones' in legend` then narrows it, and
 * neither branch can read a field the other owns.
 */
type SkyLegend =
  | { zones: string[] }
  | { ramp: string; low: string; high: string }

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
  /** The same face the map's playback marker wears, when there is one. */
  avatarUrl?: string
  /** The label cadence is measured in, for the legend. */
  cadenceLabel?: string
  /** Omitted while the panel is already expanded, exactly as the map's is. */
  onExpand?: () => void
}

/** Widest at the launch, finest at the destination: that is the whole illusion. */
function widthAt(depth: number): number {
  return 5.4 - depth * 3.8
}

export default function SessionProfile({
  id, duration, hrTimeline, cadenceTimeline, maxHR, pauses, currentTime,
  tint, onTintChange, onScrub, avatarUrl, cadenceLabel = 'spm', onExpand,
}: SessionProfileProps) {
  // Unique per mounted panel: two of these on one page would otherwise share a
  // clip path, and whichever mounted last would own it.
  const clipId = useId()
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

  /**
   * What the colours mean, in the map's own vocabulary.
   *
   * The same two shapes the track legend uses — named zones on one row, or a
   * ramp with its two ends underneath — because this panel stands in for the
   * map and a second way of saying "blue is slow" would be a second thing to
   * learn. Absent on a plain path, exactly as the map's is on the default
   * shading: there is nothing to explain.
   */
  const legend = useMemo<SkyLegend | null>(() => {
    if (effective === 'hr') return { zones: HR_ZONE_SHORT }
    if (effective !== 'cadence' || cadenceTimeline.length === 0) return null
    const values = cadenceTimeline.map(p => p.cad)
    return {
      // The same 210°→20° sweep the segments are drawn with, as a gradient.
      ramp: 'linear-gradient(to right, hsl(210 78% 52%), hsl(115 78% 52%), hsl(20 78% 52%))',
      low: `${Math.round(Math.min(...values))} ${cadenceLabel}`,
      high: `${Math.round(Math.max(...values))} ${cadenceLabel}`,
    }
  }, [effective, cadenceTimeline, cadenceLabel])

  const played = duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) : 0
  // Interpolated rather than snapped to the nearest stored point: at 110 points
  // an hour-long session moves the marker in visible steps, and the map's
  // marker beside it does not.
  const here = pointAt(sky.points, played)

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

          {/* Where playback has reached, wearing the same face as the map's
              marker so the drawing reads as "you, here" rather than as an
              anonymous dot. It shrinks with the path — this is the one mark
              whose size has to agree with the recession around it, or the
              illusion goes with it. */}
          {here && (() => {
            const r = 10.5 - here.depth * 3.5
            return (
              <g>
                <circle cx={here.x} cy={here.y} r={r + 3} fill="var(--text)" opacity="0.13" />
                {avatarUrl ? (
                  <>
                    <clipPath id={clipId}><circle cx={here.x} cy={here.y} r={r} /></clipPath>
                    <image
                      href={avatarUrl}
                      x={here.x - r} y={here.y - r} width={r * 2} height={r * 2}
                      preserveAspectRatio="xMidYMid slice"
                      clipPath={`url(#${clipId})`}
                    />
                    <circle cx={here.x} cy={here.y} r={r} fill="none" stroke="var(--primary)" strokeWidth="1.6" />
                  </>
                ) : (
                  <circle cx={here.x} cy={here.y} r={r * 0.55} fill="var(--text)" stroke="var(--bg-2)" strokeWidth="1.2" />
                )}
              </g>
            )
          })()}
        </svg>

        {onExpand && (
          <button
            className="btn-icon session-sky-expand"
            onClick={onExpand}
            title="Expand"
            aria-label="Expand the session"
          >
            <Maximize2 size={14} />
          </button>
        )}

        {/* Legend and picker stack in the same corner, the legend above: they
            are one control and its key, and putting the key on the opposite
            side of the drawing would mean reading across the picture to find
            out what the colours mean. */}
        <div className="session-sky-controls">
          {legend && (
            <div className="map-legend session-sky-legend" aria-label="Colour scale">
              {'zones' in legend
                ? (
                  <div className="map-legend-zones">
                    {legend.zones.map((z, i) => (
                      <span key={z} className="map-legend-zone">
                        <i style={{ background: HR_ZONE_COLORS[i] }} />
                        {z}
                      </span>
                    ))}
                  </div>
                )
                : (
                  <div className="map-legend-ramp">
                    <i style={{ background: legend.ramp }} />
                    <span>
                      <span>{legend.low}</span>
                      <span>{legend.high}</span>
                    </span>
                  </div>
                )}
            </div>
          )}
          {options.length > 1 && (
            <Dropdown value={effective} onChange={onTintChange} dropUp ariaLabel="Path colour" options={options} />
          )}
        </div>
      </div>
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
