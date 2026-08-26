import type React from 'react'
import { Orbit } from 'lucide-react'
import { TYPE_COLOR, TYPE_ICON, type WorkoutType } from '../data/workouts'

/**
 * The colour a sport is drawn in, tolerating "no sport in particular".
 *
 * An empty type is not "Other" — Other is a workout whose type could not be
 * determined, whereas a goal spanning every sport deliberately counts
 * everything. That case gets the user's accent, because no sport colour is the
 * honest answer and the accent carries no meaning of its own to contradict.
 */
export function sportColor(type: WorkoutType | ''): string {
  return type ? TYPE_COLOR[type] : 'var(--primary)'
}

/**
 * A sport's mark, in the sport's own colour, optionally on a tinted disc.
 *
 * Sport is encoded twice on purpose — colour and shape. Colour alone fails for
 * the ~8% of men with a colour vision deficiency, fails again in a screenshot
 * someone has desaturated, and fails hardest here because two of the six sport
 * hues are neighbours. Anywhere something names its sport, it names it both
 * ways.
 *
 * The disc is the app's one treatment for "this card is about this sport" — the
 * goal tiles and the personal-best cards both use it, so the two look like one
 * system rather than a disc on one card and a bare glyph on the next.
 */
export default function SportMark({ type, size = 14, disc }: {
  type: WorkoutType | ''
  size?: number | string
  /** Seat the icon on a tinted disc in the same hue. */
  disc?: boolean
}) {
  // Orbit rather than a dashed circle: an empty type here is "everything in the
  // library", not "unclassified", and CircleDashed already means the latter on
  // workouts.
  const Icon = type ? TYPE_ICON[type] : Orbit
  const icon = <Icon size={size} color={sportColor(type)} aria-hidden />
  if (!disc) return icon
  // The hue goes on the wrapper as a variable so the disc's fill and ring can
  // be mixed from it in CSS rather than computed twice here.
  return (
    <span className="sport-disc" style={{ '--sport-hue': sportColor(type) } as React.CSSProperties}>
      {icon}
    </span>
  )
}
