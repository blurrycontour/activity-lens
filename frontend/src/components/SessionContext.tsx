import { History } from 'lucide-react'
import TypeIcon from './TypeIcon'
import type { Standing } from '../lib/standing'
import { TYPE_COLOR, type Workout } from '../data/workouts'

/**
 * The last rung of the hero ladder: a workout with no route and no samples.
 *
 * A strength session imported from a watch is often a type, a date and a
 * duration, and there is nothing about it to draw. What there is, is a library
 * — so instead of an empty frame the slot says where this session sits in it:
 * how it ranks, how long since the last one, how much of this sport lately.
 *
 * The facts are computed by the page rather than here, because whether there
 * are any is what decides that this panel is shown at all: a first-ever workout
 * of its type has nothing to say, and a card reading "1st of 1" is worse than
 * letting the summary take the width.
 */
export default function SessionContext({ workout, facts }: { workout: Workout; facts: Standing[] }) {
  const color = TYPE_COLOR[workout.type] ?? 'var(--primary)'

  return (
    <div className="session-context">
      <div className="session-profile-head">
        <History size={14} style={{ color: 'var(--text-3)' }} />
        <h3>In context</h3>
        <span className="session-profile-note">No route recorded</span>
      </div>

      {/* The sport mark at size, because with no map and no chart this panel is
          also the only thing giving the page a visual identity. The mark draws
          itself in the sport's colour; only the disc behind it is tinted here. */}
      <div className="session-context-body">
        <span
          className="session-context-mark"
          style={{ background: `color-mix(in srgb, ${color} 14%, transparent)` }}
          aria-hidden
        >
          <TypeIcon type={workout.type} size={26} />
        </span>

        <dl className="session-context-facts">
          {facts.map(f => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>
                {f.value}
                {f.hint && <span> {f.hint}</span>}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
