import { TYPE_ICON, type WorkoutType } from '../data/workouts'
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

const OPTIONS: DropdownOption<Option>[] = (['All', 'Run', 'Ride', 'Hike', 'Swim', 'Strength'] as Option[])
  .map(o => ({
    value: o,
    label: o === 'All' ? 'All Types' : o,
    color: SPORT_COLOR[o],
    glyph: o === 'All' ? undefined : TYPE_ICON[o as WorkoutType],
  }))

/** Activity-type filter. */
export default function TypeDropdown({ value, onChange }: {
  value: Option
  onChange: (v: Option) => void
}) {
  return <Dropdown value={value} options={OPTIONS} onChange={onChange} ariaLabel="Activity type" />
}
