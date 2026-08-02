import { TYPE_ICON, type WorkoutType } from '../data/workouts'

interface TypeIconProps {
  type: WorkoutType
  /**
   * Defaults to `1em`, so the icon takes its size from whatever the container
   * already sets — the sport tiles and rows size themselves per breakpoint in
   * `index.css`, and this keeps that one definition rather than duplicating the
   * numbers here. Pass a number where there is no font-size to inherit.
   */
  size?: number | string
}

/**
 * The sport mark, sized to its container and drawn in `currentColor`.
 *
 * A component rather than `TYPE_ICON[type]` at each call site: the lookup yields
 * a component, which JSX will only render from a capitalised binding, so every
 * caller would otherwise need its own `const Icon = …` line first.
 */
export default function TypeIcon({ type, size = '1em' }: TypeIconProps) {
  const Icon = TYPE_ICON[type]
  return <Icon size={size} aria-hidden />
}
