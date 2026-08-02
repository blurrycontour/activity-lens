import { Layers } from 'lucide-react'
import { type WorkoutType } from '../data/workouts'
import TypeIcon from './TypeIcon'
import Dropdown, { type DropdownOption } from './Dropdown'

type Option = WorkoutType | 'All'

const SPORT_COLOR: Record<Option, string> = {
  All: 'var(--text-3)',
  Run: 'var(--run)',
  Ride: 'var(--ride)',
  Hike: 'var(--hike)',
  Swim: 'var(--swim)',
  Strength: 'var(--strength)',
}

/**
 * "All" carries a mark of its own rather than falling back to a colour dot.
 * One option shaped unlike the other five reads as an oversight, and the dot it
 * would otherwise get is the same grey as the label beside it anyway.
 */
const OPTIONS: DropdownOption<Option>[] = (['All', 'Run', 'Ride', 'Hike', 'Swim', 'Strength'] as Option[])
  .map(o => ({
    value: o,
    label: o === 'All' ? 'All Types' : o,
    color: SPORT_COLOR[o],
    glyph: o === 'All'
      ? <Layers size={14} color="var(--text-3)" aria-hidden />
      : <TypeIcon type={o as WorkoutType} size={14} />,
  }))

/** Activity-type filter. */
export default function TypeDropdown({ value, onChange }: {
  value: Option
  onChange: (v: Option) => void
}) {
  return <Dropdown value={value} options={OPTIONS} onChange={onChange} ariaLabel="Activity type" />
}
