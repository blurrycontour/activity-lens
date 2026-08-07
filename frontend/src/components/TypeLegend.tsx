import { TYPE_COLOR, ALL_WORKOUT_TYPES, type WorkoutType } from '../data/workouts'

/**
 * Key for a chart whose marks are coloured by activity type.
 *
 * Colour alone is never an encoding: anything painted by type has to say which
 * colour is which, and the tooltip names the type in words as well.
 *
 * Only the types actually plotted appear, in the canonical order — so the
 * entries stay put as the filters change rather than reshuffling, and a colour
 * always means the same sport.
 */
export default function TypeLegend({ types }: { types: Iterable<WorkoutType> }) {
  const present = new Set(types)
  const shown = ALL_WORKOUT_TYPES.filter(t => present.has(t))
  // One sport is not a legend — the chart is simply that sport, and the page
  // filter already says so.
  if (shown.length < 2) return null

  return (
    <ul className="type-legend">
      {shown.map(t => (
        <li key={t}>
          <span className="type-legend-dot" style={{ background: TYPE_COLOR[t] }} />
          {t}
        </li>
      ))}
    </ul>
  )
}
