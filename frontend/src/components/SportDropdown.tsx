import { TYPE_COLOR, WORKOUT_TYPES, type WorkoutType } from '../data/workouts'
import TypeIcon from './TypeIcon'
import Dropdown, { type DropdownOption } from './Dropdown'

function option(t: WorkoutType): DropdownOption<WorkoutType> {
  return { value: t, label: t, color: TYPE_COLOR[t], glyph: <TypeIcon type={t} size={14} /> }
}

const OPTIONS: DropdownOption<WorkoutType>[] = WORKOUT_TYPES.map(option)

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
  // "Other" is not on offer, but a workout can already be one — an import that
  // could not be classified. Without it in the list Dropdown falls back to the
  // first option, so opening the edit form on such a workout would show "Run"
  // and saving would make that true. A picker must never quietly change the
  // value it was given.
  const options = value === 'Other' ? [...OPTIONS, option('Other')] : OPTIONS
  return <Dropdown value={value} options={options} onChange={onChange} block ariaLabel="Sport type" />
}
