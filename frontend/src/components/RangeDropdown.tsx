import { useState, useRef, useEffect } from 'react'
import { ChevronDown, CalendarRange } from 'lucide-react'
import { RANGE_OPTIONS } from '../lib/range'

interface RangeDropdownProps {
  /** Day count for the selected range; 0 means all time. */
  value: number
  onChange: (v: number) => void
}

/** Time-range picker shared by the Analysis, Heatmap and Timeline pages. */
export default function RangeDropdown({ value, onChange }: RangeDropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  const selected = RANGE_OPTIONS.find(o => o.value === value) ?? RANGE_OPTIONS[1]

  return (
    <div className="al-dropdown" ref={ref}>
      <button className="al-dropdown-trigger" onClick={() => setOpen(o => !o)} type="button">
        <CalendarRange size={13} color="var(--text-3)" style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, textAlign: 'left' }}>{selected.label}</span>
        <ChevronDown
          size={14}
          color="var(--text-3)"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
        />
      </button>

      {open && (
        <div className="al-dropdown-menu" style={{ animation: 'fadeIn 0.12s ease' }}>
          {RANGE_OPTIONS.map(opt => (
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
