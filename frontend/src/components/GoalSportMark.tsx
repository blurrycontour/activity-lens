import type React from 'react'
import { Orbit } from 'lucide-react'
import { TYPE_COLOR, TYPE_ICON, type WorkoutType } from '../data/workouts'

/**
 * The colour a goal is drawn in.
 *
 * A goal with no sport is not "Other" — Other is a workout whose type could not
 * be determined, whereas this goal deliberately counts everything. It gets the
 * user's accent, because a goal spanning every sport is the one case where no
 * sport colour is the honest answer and the accent carries no meaning of its
 * own to contradict.
 */
export function goalColor(type: WorkoutType | ''): string {
  return type ? TYPE_COLOR[type] : 'var(--primary)'
}

/**
 * The sport mark for a goal, in the goal's own colour.
 *
 * Sport is encoded twice on purpose — colour and shape. Colour alone fails for
 * the ~8% of men with a colour vision deficiency, fails again in a screenshot
 * someone has desaturated, and fails hardest here because two of the six sport
 * hues are neighbours. Anywhere a goal names its sport, it names it both ways.
 */
export default function GoalSportMark({ type, size = 14, disc }: {
  type: WorkoutType | ''
  size?: number | string
  /** Seat the icon on a tinted disc in the same hue. */
  disc?: boolean
}) {
  // Orbit rather than a dashed circle: this is "everything in the library",
  // not "unclassified", and CircleDashed already means the latter on workouts.
  const Icon = type ? TYPE_ICON[type] : Orbit
  const icon = <Icon size={size} color={goalColor(type)} aria-hidden />
  if (!disc) return icon
  // The hue goes on the wrapper as a variable so the disc's fill and ring can
  // be mixed from it in CSS rather than computed twice here.
  return (
    <span className="goal-sport-disc" style={{ '--goal-hue': goalColor(type) } as React.CSSProperties}>
      {icon}
    </span>
  )
}
