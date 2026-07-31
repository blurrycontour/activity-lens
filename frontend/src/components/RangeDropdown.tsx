import { CalendarRange } from 'lucide-react'
import { RANGE_OPTIONS } from '../lib/range'
import Dropdown from './Dropdown'

/** Time-range picker shared by the Analysis and Consistency pages. */
export default function RangeDropdown({ value, onChange }: {
  /** Day count for the selected range; 0 means all time. */
  value: number
  onChange: (v: number) => void
}) {
  return (
    <Dropdown
      value={value}
      options={RANGE_OPTIONS}
      onChange={onChange}
      ariaLabel="Time range"
      icon={<CalendarRange size={13} color="var(--text-3)" style={{ flexShrink: 0 }} />}
    />
  )
}
