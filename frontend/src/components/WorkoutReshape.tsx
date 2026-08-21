import { useCallback, useMemo, useRef } from 'react'
import { Footprints, Heart, LineChart, MapPin, Mountain, Timer } from 'lucide-react'
import { fmtDuration, type Workout } from '../data/workouts'
import { extraSeriesMeta } from '../lib/extraSeries'

/**
 * A series that can be dropped, matching workout.Stream on the server.
 *
 * The `extra:` half is open, because that half of what a workout records is:
 * a power meter that was reading nonsense is exactly as worth removing as a
 * chest strap that dropped out, and the server accepts the same shape.
 */
export type Stream = 'hr' | 'cadence' | 'elevation' | 'pace' | 'route' | `extra:${string}`

/** The staged edit: what to keep, and what to throw away. */
export interface ReshapePlan {
  /** Seconds from the original start. */
  start: number
  /** Seconds from the original start; the workout's duration means "all of it". */
  end: number
  drop: Stream[]
}

export function emptyPlan(w: Workout): ReshapePlan {
  return { start: 0, end: w.duration, drop: [] }
}

/** Whether the plan would change anything at all. */
export function planChanges(w: Workout, p: ReshapePlan): boolean {
  return p.start > 0 || p.end < w.duration || p.drop.length > 0
}

/** The shortest a trimmed workout may be; mirrors MinTrimSeconds on the server. */
const MIN_KEPT = 10

const STREAMS: { id: Stream; label: string; glyph: React.ReactNode; count: (w: Workout) => number }[] = [
  { id: 'hr', label: 'Heart rate', glyph: <Heart size={14} />, count: w => w.hrTimeline?.length ?? 0 },
  { id: 'cadence', label: 'Cadence', glyph: <Footprints size={14} />, count: w => w.cadenceTimeline?.length ?? 0 },
  { id: 'elevation', label: 'Elevation', glyph: <Mountain size={14} />, count: w => w.elevTimeline?.length ?? 0 },
  { id: 'pace', label: 'Pace', glyph: <Timer size={14} />, count: w => w.paceTimeline?.length ?? 0 },
  { id: 'route', label: 'GPS route', glyph: <MapPin size={14} />, count: w => w.route?.length ?? 0 },
]

/** The streams this workout actually recorded — the only ones worth offering. */
export function presentStreams(w: Workout) {
  const extras = Object.entries(w.extraSeries ?? {})
    .filter(([, points]) => (points?.length ?? 0) > 0)
    .map(([key, points]) => ({
      id: `extra:${key}` as Stream,
      label: extraSeriesMeta(key).label,
      glyph: <LineChart size={14} />,
      count: () => points.length,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
  return [...STREAMS.filter(s => s.count(w) > 0), ...extras]
}

/** mm:ss, or h:mm:ss past an hour. Parsed back by `parseClock`. */
function clock(secs: number): string {
  const s = Math.max(0, Math.round(secs))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`
}

/**
 * Reads "8:30", "1:08:30" or a bare "510" back into seconds.
 *
 * Lenient on purpose: this is a text box someone types into mid-edit, and
 * refusing a half-finished value would fight them on every keystroke. Anything
 * unreadable returns null and the caller keeps the previous value.
 */
export function parseClock(text: string): number | null {
  const parts = text.trim().split(':')
  if (parts.some(p => p !== '' && !/^\d+$/.test(p))) return null
  const nums = parts.map(p => (p === '' ? 0 : Number(p)))
  if (nums.length === 1) return nums[0]
  if (nums.length === 2) return nums[0] * 60 + nums[1]
  if (nums.length === 3) return nums[0] * 3600 + nums[1] * 60 + nums[2]
  return null
}

/**
 * Editing what a workout recorded: the stretch to keep, and the series to drop.
 *
 * Staged, never applied. Everything here edits a plan the caller holds, and the
 * caller applies it on Save — the same rule the rest of the edit form follows,
 * and the one that makes a destructive edit safe to experiment with.
 *
 * The strip is drawn from whichever series the workout has, because its job is
 * to let you see where the extra time is: a run that ends with four flat
 * minutes in a car park looks exactly like that in the pace or elevation trace.
 */
export default function WorkoutReshape({ workout: w, plan, onChange, hasOriginal }: {
  workout: Workout
  plan: ReshapePlan
  onChange: (p: ReshapePlan) => void
  /**
   * Whether the file this was imported from is still archived.
   *
   * Said out loud rather than left to be discovered: it is the difference
   * between an edit you can undo from the workout's own menu and one you
   * cannot, and it depends on a server setting the person editing may not have
   * chosen. Without this the Restore entry is simply missing with no
   * explanation.
   */
  hasOriginal: boolean
}) {
  const streams = presentStreams(w)

  // Whichever series has the most to say about where the workout was idle.
  const shape = useMemo(() => {
    const series: { t: number; v: number }[] =
      (w.paceTimeline?.length ?? 0) > 1 ? w.paceTimeline!.map(p => ({ t: p.t, v: -p.pace }))
        : (w.elevTimeline?.length ?? 0) > 1 ? w.elevTimeline!.map(p => ({ t: p.t, v: p.elev }))
          : (w.hrTimeline?.length ?? 0) > 1 ? w.hrTimeline!.map(p => ({ t: p.t, v: p.hr }))
            : []
    if (series.length < 2 || w.duration <= 0) return ''
    const vs = series.map(p => p.v)
    const lo = Math.min(...vs)
    const hi = Math.max(...vs)
    const span = hi - lo || 1
    return series
      .map(p => `${(p.t / w.duration) * 100},${30 - ((p.v - lo) / span) * 28}`)
      .join(' ')
  }, [w])

  const trackRef = useRef<HTMLDivElement>(null)

  /** Where a pointer is, as seconds into the workout. */
  const secondsAt = useCallback((clientX: number): number => {
    const box = trackRef.current?.getBoundingClientRect()
    if (!box || box.width === 0) return 0
    const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width))
    return Math.round(ratio * w.duration)
  }, [w.duration])

  /** Moves whichever handle is nearer to a point on the track. */
  const moveNearest = useCallback((at: number) => {
    const toStart = Math.abs(at - plan.start)
    const toEnd = Math.abs(at - plan.end)
    if (toStart <= toEnd) onChange({ ...plan, start: Math.max(0, Math.min(at, plan.end - MIN_KEPT)) })
    else onChange({ ...plan, end: Math.min(w.duration, Math.max(at, plan.start + MIN_KEPT)) })
  }, [plan, onChange, w.duration])

  const drag = (edge: 'start' | 'end') => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const move = (ev: Event) => {
      const at = secondsAt((ev as PointerEvent).clientX)
      // Each handle stops short of the other rather than pushing it: a drag
      // that swapped them would silently invert the window.
      if (edge === 'start') onChange({ ...plan, start: Math.min(at, plan.end - MIN_KEPT) })
      else onChange({ ...plan, end: Math.max(at, plan.start + MIN_KEPT) })
    }
    const up = () => {
      el.releasePointerCapture(e.pointerId)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const setStart = (text: string) => {
    const v = parseClock(text)
    if (v === null) return
    onChange({ ...plan, start: Math.max(0, Math.min(v, plan.end - MIN_KEPT)) })
  }
  const setEnd = (text: string) => {
    const v = parseClock(text)
    if (v === null) return
    onChange({ ...plan, end: Math.min(w.duration, Math.max(v, plan.start + MIN_KEPT)) })
  }

  const kept = plan.end - plan.start
  const trimmed = plan.start > 0 || plan.end < w.duration
  // Distance follows the clock when there is nothing to measure, which is what
  // the server does too — see trimWorkout.
  const keptDistance = w.duration > 0 ? (w.distance * kept) / w.duration : w.distance

  const startPct = w.duration > 0 ? (plan.start / w.duration) * 100 : 0
  const endPct = w.duration > 0 ? (plan.end / w.duration) * 100 : 100

  return (
    <div className="reshape">
      <div className="reshape-head">
        <span className="reshape-title">Trim</span>
        <span className="reshape-note">
          {trimmed
            ? `Keeping ${fmtDuration(kept)} of ${fmtDuration(w.duration)}${w.distance > 0 ? ` · about ${(keptDistance / 1000).toFixed(2)} km` : ''}`
            : 'Drag the handles, or type exact times'}
        </span>
      </div>

      {/* Clicking the track pulls the nearer handle to the click: it is what
          everyone tries first, and dragging a 22px handle to the far end of a
          two-hour workout is the alternative. The handles stop the event, so
          this never fires from a drag that started on one. */}
      <div
        className="reshape-track"
        ref={trackRef}
        onPointerDown={e => moveNearest(secondsAt(e.clientX))}
      >
        {shape && (
          <svg className="reshape-shape" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden>
            <polyline points={shape} />
          </svg>
        )}
        {/* The parts being thrown away, dimmed rather than hidden: seeing how
            much is going is the point of drawing this at all. */}
        <div className="reshape-cut" style={{ left: 0, width: `${startPct}%` }} />
        <div className="reshape-cut" style={{ left: `${endPct}%`, right: 0 }} />
        <div className="reshape-keep" style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }} />
        <div
          className="reshape-handle"
          style={{ left: `${startPct}%` }}
          onPointerDown={drag('start')}
          role="slider"
          tabIndex={0}
          aria-label="Trim from the start"
          aria-valuemin={0}
          aria-valuemax={w.duration}
          aria-valuenow={plan.start}
          aria-valuetext={clock(plan.start)}
          onKeyDown={e => {
            if (e.key === 'ArrowLeft') setStart(String(Math.max(0, plan.start - 5)))
            if (e.key === 'ArrowRight') setStart(String(plan.start + 5))
          }}
        />
        <div
          className="reshape-handle"
          style={{ left: `${endPct}%` }}
          onPointerDown={drag('end')}
          role="slider"
          tabIndex={0}
          aria-label="Trim from the end"
          aria-valuemin={0}
          aria-valuemax={w.duration}
          aria-valuenow={plan.end}
          aria-valuetext={clock(plan.end)}
          onKeyDown={e => {
            if (e.key === 'ArrowLeft') setEnd(String(Math.max(0, plan.end - 5)))
            if (e.key === 'ArrowRight') setEnd(String(plan.end + 5))
          }}
        />
      </div>

      <div className="reshape-times">
        <label>
          <span>Start</span>
          {/* Uncontrolled by design: a controlled box would rewrite "1:" into
              "1:00" as it is typed. It reports on blur and on Enter instead. */}
          <input
            className="input"
            defaultValue={clock(plan.start)}
            key={`start-${plan.start}`}
            onBlur={e => setStart(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            inputMode="numeric"
            aria-label="Trim start, mm:ss"
          />
        </label>
        <label>
          <span>End</span>
          <input
            className="input"
            defaultValue={clock(plan.end)}
            key={`end-${plan.end}`}
            onBlur={e => setEnd(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            inputMode="numeric"
            aria-label="Trim end, mm:ss"
          />
        </label>
        {trimmed && (
          <button className="btn btn-ghost" onClick={() => onChange({ ...plan, start: 0, end: w.duration })}>
            Reset
          </button>
        )}
      </div>

      {/* What Save will and will not be able to take back. */}
      <p className={`reshape-undo${hasOriginal ? '' : ' warn'}`}>
        {hasOriginal
          ? 'The file you imported is kept, so this can be undone later with "Restore from original".'
          : 'No original file is archived for this workout, so trimming and removals cannot be undone. Ask an administrator to turn on "Keep original uploads" to change that for future imports.'}
      </p>

      {streams.length > 0 && (
        <>
          <div className="reshape-head" style={{ marginTop: 18 }}>
            <span className="reshape-title">Recorded data</span>
            <span className="reshape-note">Switch off anything this workout should not have</span>
          </div>
          <div className="reshape-streams">
            {streams.map(s => {
              const dropped = plan.drop.includes(s.id)
              return (
                <label key={s.id} className={`reshape-stream${dropped ? ' dropped' : ''}`}>
                  <span className="reshape-stream-mark">{s.glyph}</span>
                  <span className="reshape-stream-name">{s.label}</span>
                  <span className="reshape-stream-count">
                    {dropped ? 'will be removed' : `${s.count(w).toLocaleString()} samples`}
                  </span>
                  <span className="switch">
                    <input
                      type="checkbox"
                      checked={!dropped}
                      onChange={e => onChange({
                        ...plan,
                        drop: e.target.checked ? plan.drop.filter(d => d !== s.id) : [...plan.drop, s.id],
                      })}
                    />
                    <span className="switch-track" />
                  </span>
                </label>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
