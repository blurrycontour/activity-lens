import type React from 'react'
import { Check, Clock, Flame, Mountain, Navigation } from 'lucide-react'
import { fmtDist, fmtDuration, fmtRate, TYPE_COLOR, type Workout } from '../data/workouts'
import TypeIcon from './TypeIcon'
import SourceMark from './SourceMark'
import { useLongPress } from '../lib/useLongPress'

/**
 * One workout, as a row or a tile.
 *
 * Lived inside the workouts page until the gear page needed to list the
 * workouts using a piece of equipment. Two lists of workouts in one app that
 * disagree about what a workout looks like is the kind of difference nobody
 * decides on — so this moved out here rather than being approximated a second
 * time, and the gear page passes an X in the `aside` slot where the library
 * puts its share and export controls.
 */
export type WorkoutCardData = Pick<
  Workout,
  'name' | 'type' | 'date' | 'distance' | 'duration' | 'elevationGain' | 'calories' | 'avgPace' | 'avgSpeed' | 'source'
>

/**
 * The tick on a row while selecting.
 *
 * The opposite corner to the auto-import mark, which shares this icon: the two
 * were drawn on top of each other, and hiding one to show the other meant a row
 * silently changed what it was telling you the moment a selection began.
 */
function SelectionMark({ selected }: { selected: boolean }) {
  return (
    <span
      className={`selection-mark${selected ? ' on' : ''}`}
      aria-hidden
    >
      {selected ? <Check size={10} strokeWidth={3} /> : null}
    </span>
  )
}

interface WorkoutCardProps {
  workout: WorkoutCardData
  variant: 'list' | 'grid'
  onClick: () => void
  /** Whether press-and-hold does anything here. Your own library only. */
  selectable?: boolean
  /** Whether the page is in selection mode, which changes what a click means. */
  selecting?: boolean
  selected?: boolean
  onLongPress?: () => void
  /** Sharing indicator shown beside the type tag on your own workouts. */
  badge?: React.ReactNode
  /** Trailing controls, shown beside the pace figure. */
  aside?: React.ReactNode
  /** Full-width row at the bottom of the card, used for the author byline. */
  footer?: React.ReactNode
}

export default function WorkoutCard({
  workout: w, variant, onClick, badge, aside, footer,
  selectable = false, selecting = false, selected = false, onLongPress,
}: WorkoutCardProps) {
  const color = TYPE_COLOR[w.type]
  const press = useLongPress(() => onLongPress?.())
  // The click that ends a long press must not also open the workout.
  const handleClick = () => { if (!press.consumedClick()) onClick() }
  const pressProps = selectable ? press.handlers : {}
  const selectionStyle: React.CSSProperties = selected
    ? { outline: '2px solid var(--primary)', outlineOffset: -2 }
    : {}
  const dateLabel = new Date(w.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const rate = fmtRate(w)

  if (variant === 'grid') {
    return (
      <div
        onClick={handleClick}
        {...pressProps}
        style={{
          ...selectionStyle,
          background: 'var(--bg-2)',
          border: '1px solid var(--border)',
          borderTop: `3px solid ${color}`,
          borderRadius: 12,
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          cursor: 'pointer',
          transition: 'all 0.15s',
          minWidth: 0,
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = `${color}40`; e.currentTarget.style.background = 'var(--bg-3)' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.borderTopColor = color; e.currentTarget.style.background = 'var(--bg-2)' }}
      >
        {/* Header: icon + type + name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10, flexShrink: 0,
            background: `${color}18`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
            position: 'relative',
          }}>
            <TypeIcon type={w.type} />
            <SourceMark source={w.source} />
            {selecting && <SelectionMark selected={selected} />}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
              <span className={`badge tag-${w.type.toLowerCase()}`}>{w.type}</span>
              <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{dateLabel}</span>
              {badge}
            </div>
          </div>
        </div>

        {/* Primary metric */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, paddingBottom: 4, borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 24, fontWeight: 700, color }}>
            {rate.value}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>{rate.unit}</span>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', rowGap: 6, alignItems: 'center' }}>
          {w.distance > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <Navigation size={11} color="var(--text-3)" />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)' }}>{fmtDist(w.distance)}</span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <Clock size={11} color="var(--text-3)" />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)' }}>{fmtDuration(w.duration)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <Mountain size={11} color="var(--text-3)" />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)' }}>+{w.elevationGain}m</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <Flame size={11} color="var(--text-3)" />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)' }}>{w.calories} kcal</span>
          </div>
          <div style={{ marginLeft: 'auto' }}>{aside}</div>
        </div>
        {footer && <div className="workout-card-footer">{footer}</div>}
      </div>
    )
  }

  return (
    <div
      className="workout-row"
      onClick={handleClick}
      {...pressProps}
      style={{ '--row-accent': color, ...selectionStyle } as React.CSSProperties}
    >
      <div className="workout-row-icon">
        <TypeIcon type={w.type} />
        <SourceMark source={w.source} />
        {selecting && <SelectionMark selected={selected} />}
      </div>

      <div className="workout-row-body">
        <div className="workout-row-title">
          <span className="workout-row-name">{w.name}</span>
          <span className={`badge tag-${w.type.toLowerCase()}`}>{w.type}</span>
          {badge}
        </div>
        {/* Date and stats share a line on desktop; the mobile rule in index.css
            breaks the date onto its own line above them. */}
        <div className="workout-row-meta">
          <span className="workout-row-date">{dateLabel}</span>
          <div className="workout-row-stats">
            {w.distance > 0 && (
              <div className="workout-row-stat">
                <Navigation size={11} color="var(--text-3)" />
                <span>{fmtDist(w.distance)}</span>
              </div>
            )}
            <div className="workout-row-stat">
              <Clock size={11} color="var(--text-3)" />
              <span>{fmtDuration(w.duration)}</span>
            </div>
            <div className="workout-row-stat optional">
              <Mountain size={11} color="var(--text-3)" />
              <span>+{w.elevationGain}m</span>
            </div>
            <div className="workout-row-stat optional">
              <Flame size={11} color="var(--text-3)" />
              <span>{w.calories} kcal</span>
            </div>
          </div>
        </div>
        {footer && <div className="workout-row-footer">{footer}</div>}
      </div>

      <div className="workout-row-aside">
        <div className="workout-row-pace">
          <b>{rate.value}</b>
          <small>{rate.unit}</small>
        </div>
        {aside}
      </div>
    </div>
  )
}
