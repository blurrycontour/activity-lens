import { useState, useRef, useEffect } from 'react'
import { ChevronDown, ArrowDownWideNarrow } from 'lucide-react'

export type SortKey = 'date' | 'distance' | 'duration'

/** Every sort is descending — newest, longest, furthest first. */
export const SORT_OPTIONS: { value: SortKey; label: string; short: string }[] = [
  { value: 'date', label: 'Newest first', short: 'Date' },
  { value: 'distance', label: 'Longest distance', short: 'Dist' },
  { value: 'duration', label: 'Longest time', short: 'Time' },
]

interface SortDropdownProps {
  value: SortKey
  onChange: (v: SortKey) => void
}

/** Sort picker for the workout list, styled to match TypeDropdown/RangeDropdown. */
export default function SortDropdown({ value, onChange }: SortDropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  const selected = SORT_OPTIONS.find(o => o.value === value) ?? SORT_OPTIONS[0]

  return (
    <div className="al-dropdown" ref={ref}>
      <button className="al-dropdown-trigger" onClick={() => setOpen(o => !o)} type="button">
        <ArrowDownWideNarrow size={13} color="var(--text-3)" style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, textAlign: 'left' }}>{selected.label}</span>
        <ChevronDown
          size={14}
          color="var(--text-3)"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
        />
      </button>

      {open && (
        <div className="al-dropdown-menu" style={{ animation: 'fadeIn 0.12s ease' }}>
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt.value}
              className={`al-dropdown-item ${value === opt.value ? 'active' : ''}`}
              onClick={() => { onChange(opt.value); setOpen(false) }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', width: 28, flexShrink: 0 }}>{opt.short}</span>
              {opt.label}
              {value === opt.value && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--primary)' }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
