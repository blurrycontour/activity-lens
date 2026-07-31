import { ArrowDownWideNarrow } from 'lucide-react'
import Dropdown, { type DropdownOption } from './Dropdown'

/** A sort field paired with its direction, e.g. `distance-asc`. */
export type SortKey =
  | 'date-desc' | 'date-asc'
  | 'distance-desc' | 'distance-asc'
  | 'duration-desc' | 'duration-asc'

export const SORT_OPTIONS: DropdownOption<SortKey>[] = [
  { value: 'date-desc', label: 'Newest first', short: '↓' },
  { value: 'date-asc', label: 'Oldest first', short: '↑' },
  { value: 'distance-desc', label: 'Longest distance', short: '↓' },
  { value: 'distance-asc', label: 'Shortest distance', short: '↑' },
  { value: 'duration-desc', label: 'Longest time', short: '↓' },
  { value: 'duration-asc', label: 'Shortest time', short: '↑' },
]

/**
 * Orders workouts by the chosen field and direction. Dates are compared as
 * YYYY-MM-DD strings, which sorts correctly without parsing into a Date and
 * picking up timezone drift.
 */
export function compareBySort<T extends { date: string; distance: number; duration: number }>(
  key: SortKey,
): (a: T, b: T) => number {
  const [field, dir] = key.split('-') as ['date' | 'distance' | 'duration', 'asc' | 'desc']
  const sign = dir === 'asc' ? -1 : 1
  return (a, b) => sign * (
    field === 'date' ? b.date.localeCompare(a.date)
      : field === 'distance' ? b.distance - a.distance
        : b.duration - a.duration
  )
}

/** Sort picker for the workout list. */
export default function SortDropdown({ value, onChange }: {
  value: SortKey
  onChange: (v: SortKey) => void
}) {
  return (
    <Dropdown
      value={value}
      options={SORT_OPTIONS}
      onChange={onChange}
      ariaLabel="Sort order"
      icon={<ArrowDownWideNarrow size={13} color="var(--text-3)" style={{ flexShrink: 0 }} />}
    />
  )
}
