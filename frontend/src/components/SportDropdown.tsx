import { TYPE_COLOR, WORKOUT_TYPES, type WorkoutType } from '../data/workouts'
import TypeIcon from './TypeIcon'
import Dropdown, { type DropdownOption } from './Dropdown'

const OPTIONS: DropdownOption<WorkoutType>[] = WORKOUT_TYPES.map(t => ({
  value: t,
  label: t,
  color: TYPE_COLOR[t],
  glyph: <TypeIcon type={t} size={14} />,
}))

/**
 * Picks which sport a workout is, for the add and edit forms.
 *
 * Separate from `TypeDropdown`, which filters and therefore offers "All" — a
 * value a workout cannot have. Splitting them keeps that out of the type rather
 * than leaving each form to reject it at runtime.
 *
 * Both forms used a native `<select>` before this, which is why the same
 * control looked like the styled dropdown on Analysis and Consistency and like
 * the browser's own widget in the two places you actually set the value.
 */
export default function SportDropdown({ value, onChange }: {
  value: WorkoutType
  onChange: (v: WorkoutType) => void
}) {
  return <Dropdown value={value} options={OPTIONS} onChange={onChange} block ariaLabel="Sport type" />
}
