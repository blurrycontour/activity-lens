import { Layers } from 'lucide-react'
import { ALL_WORKOUT_TYPES, TYPE_COLOR, type WorkoutType } from '../data/workouts'
import TypeIcon from './TypeIcon'
import Dropdown, { type DropdownOption } from './Dropdown'

type Option = WorkoutType | 'All'

/**
 * Derived from TYPE_COLOR rather than repeating it: the two lists were separate
 * copies of the same mapping, so adding a sport failed to compile here for the
 * good reason that this file had quietly become a second source of truth.
 *
 * "All" carries a mark of its own rather than falling back to a colour dot. One
 * option shaped unlike the others reads as an oversight, and the dot it would
 * otherwise get is the same grey as the label beside it anyway.
 *
 * Every type appears, including Other — a filter has to be able to reach every
 * workout, and the unclassified ones are exactly the ones worth finding.
 */
const OPTIONS: DropdownOption<Option>[] = (['All', ...ALL_WORKOUT_TYPES] as Option[])
  .map(o => ({
    value: o,
    label: o === 'All' ? 'All Types' : o,
    color: o === 'All' ? 'var(--text-3)' : TYPE_COLOR[o as WorkoutType],
    glyph: o === 'All'
      ? <Layers size={14} color="var(--text-3)" aria-hidden />
      : <TypeIcon type={o as WorkoutType} size={14} />,
  }))

/** Activity-type filter. */
export default function TypeDropdown({ value, onChange }: {
  value: Option
  onChange: (v: Option) => void
}) {
  return <Dropdown value={value} options={OPTIONS} onChange={onChange} ariaLabel="Activity type" active={value !== 'All'} />
}
