import {
  ArrowDownWideNarrow, ArrowUpNarrowWide, ArrowUpDown,
  CalendarArrowDown, CalendarArrowUp, ClockArrowDown, ClockArrowUp,
} from 'lucide-react'
import Dropdown, { type DropdownOption } from './Dropdown'

/** A sort field paired with its direction, e.g. `distance-asc`. */
export type SortKey =
  | 'date-desc' | 'date-asc'
  | 'distance-desc' | 'distance-asc'
  | 'duration-desc' | 'duration-asc'

/**
 * Each option's mark names its field *and* its direction, so no two are alike.
 *
 * These were bare arrows in the mono `short` column, which meant three options
 * carried an identical mark and the column distinguished nothing — the label
 * beside it was doing all the work. `short` is for text that is genuinely an
 * abbreviation, as in the range picker's "7d"; a symbol standing in for an icon
 * is what this used to be.
 */
const mark = (Icon: typeof ArrowUpDown) => <Icon size={14} color="var(--text-3)" aria-hidden />

export const SORT_OPTIONS: DropdownOption<SortKey>[] = [
  { value: 'date-desc', label: 'Newest first', glyph: mark(CalendarArrowDown) },
  { value: 'date-asc', label: 'Oldest first', glyph: mark(CalendarArrowUp) },
  { value: 'distance-desc', label: 'Longest distance', glyph: mark(ArrowDownWideNarrow) },
  { value: 'distance-asc', label: 'Shortest distance', glyph: mark(ArrowUpNarrowWide) },
  { value: 'duration-desc', label: 'Longest time', glyph: mark(ClockArrowDown) },
  { value: 'duration-asc', label: 'Shortest time', glyph: mark(ClockArrowUp) },
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
      icon={<ArrowUpDown size={13} color="var(--text-3)" style={{ flexShrink: 0 }} />}
    />
  )
}
