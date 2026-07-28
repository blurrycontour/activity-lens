import { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'
import { TYPE_ICON, type WorkoutType } from '../data/workouts'

type Option = WorkoutType | 'All'

interface TypeDropdownProps {
  value: Option
  onChange: (v: Option) => void
}

const OPTIONS: Option[] = ['All', 'Run', 'Ride', 'Hike', 'Swim', 'Strength']

const SPORT_COLOR: Record<Option, string> = {
  All: 'var(--text-3)',
  Run: 'var(--run)',
  Ride: 'var(--ride)',
  Hike: 'var(--hike)',
  Swim: 'var(--swim)',
  Strength: 'var(--strength)',
}

export default function TypeDropdown({ value, onChange }: TypeDropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  const color = SPORT_COLOR[value]

  return (
    <div className="al-dropdown" ref={ref}>
      <button
        className="al-dropdown-trigger"
        onClick={() => setOpen(o => !o)}
        type="button"
      >
        <span style={{
          width: 10, height: 10, borderRadius: '50%',
          background: color, flexShrink: 0,
          boxShadow: value !== 'All' ? `0 0 6px ${color}` : 'none',
        }} />
        <span style={{ flex: 1 }}>
          {value === 'All' ? 'All Types' : `${TYPE_ICON[value as WorkoutType]} ${value}`}
        </span>
        <ChevronDown
          size={14}
          color="var(--text-3)"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
        />
      </button>

      {open && (
        <div className="al-dropdown-menu" style={{ animation: 'fadeIn 0.12s ease' }}>
          {OPTIONS.map(opt => (
            <button
              key={opt}
              className={`al-dropdown-item ${value === opt ? 'active' : ''}`}
              onClick={() => { onChange(opt); setOpen(false) }}
            >
              <span style={{
                width: 10, height: 10, borderRadius: '50%',
                background: SPORT_COLOR[opt], flexShrink: 0,
                boxShadow: opt !== 'All' ? `0 0 5px ${SPORT_COLOR[opt]}60` : 'none',
              }} />
              <span style={{ color: value === opt ? SPORT_COLOR[opt] : undefined }}>
                {opt === 'All' ? 'All Types' : `${TYPE_ICON[opt as WorkoutType]} ${opt}`}
              </span>
              {value === opt && (
                <span style={{ marginLeft: 'auto', fontSize: 11, color: SPORT_COLOR[opt] }}>✓</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
