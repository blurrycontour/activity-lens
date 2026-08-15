import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Cloud, Footprints, Heart, Image, MapPin, MessageSquare, NotebookPen, SlidersHorizontal } from 'lucide-react'
import type { Has } from '../lib/workoutFilters'

interface ContainsOption {
  value: Has
  label: string
  glyph: React.ReactNode
  /** Only answerable about your own workouts. */
  ownerOnly?: boolean
}

/**
 * What a workout can be filtered by having.
 *
 * Shared by the desktop dropdown and the mobile sheet, so the two cannot offer
 * different sets — which is exactly the drift that makes a filter mean
 * something different depending on where you opened it.
 *
 * Notes are owner-only because the server redacts them on other people's
 * workouts: offered on a feed, the filter could only ever answer "none", which
 * looks like a broken feature rather than an inapplicable one.
 */
export const CONTAINS_OPTIONS: ContainsOption[] = [
  { value: 'photos', label: 'Photos', glyph: <Image size={14} /> },
  { value: 'gps', label: 'GPS route', glyph: <MapPin size={14} /> },
  { value: 'hr', label: 'Heart rate', glyph: <Heart size={14} /> },
  { value: 'steps', label: 'Steps', glyph: <Footprints size={14} /> },
  { value: 'comments', label: 'Comments', glyph: <MessageSquare size={14} /> },
  { value: 'weather', label: 'Weather', glyph: <Cloud size={14} /> },
  { value: 'notes', label: 'Notes', glyph: <NotebookPen size={14} />, ownerOnly: true },
]

/** The options a list may offer, given whose workouts it holds. */
export function containsOptions(mine: boolean): ContainsOption[] {
  return mine ? CONTAINS_OPTIONS : CONTAINS_OPTIONS.filter(o => !o.ownerOnly)
}

/** The label for one attribute, for the chip that says it is applied. */
export function containsLabel(v: Has): string {
  return CONTAINS_OPTIONS.find(o => o.value === v)?.label ?? v
}

/**
 * The desktop half of the "contains" filter: several attributes at once.
 *
 * Its own component rather than a mode on Dropdown, which closes on choosing
 * and shows one value — both wrong here, where the point is to tick two things
 * and see them both. It borrows Dropdown's classes so it sits in the filter row
 * as one of the same controls.
 */
export default function ContainsDropdown({ value, onToggle, mine }: {
  value: Has[]
  /** Called with the attribute that was clicked; the caller owns the array. */
  onToggle: (v: Has) => void
  /** Whether these are the caller's own workouts, which unlocks Notes. */
  mine: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Click-away and Escape, the same pair every menu in the app closes on.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const options = containsOptions(mine)

  return (
    <div className="al-dropdown" ref={ref}>
      <button
        type="button"
        className="al-dropdown-trigger"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Filter by what a workout contains"
      >
        <SlidersHorizontal size={14} color="var(--text-3)" aria-hidden />
        {/* The count rather than the names: two or three labels would not fit,
            and a trigger that changes width as you tick things is worse than
            one that says how many. */}
        <span>{value.length === 0 ? 'Contains' : `Contains (${value.length})`}</span>
        <ChevronDown size={13} style={{ marginLeft: 'auto', flexShrink: 0 }} aria-hidden />
      </button>
      {open && (
        <div className="al-dropdown-menu" role="listbox" aria-multiselectable>
          {options.map(o => {
            const on = value.includes(o.value)
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={on}
                className={`al-dropdown-item${on ? ' active' : ''}`}
                // Deliberately does not close: ticking one of several is the
                // whole point, and a menu that shut each time would take four
                // clicks to say "photos and heart rate".
                onClick={() => onToggle(o.value)}
              >
                {o.glyph}
                <span style={{ flex: 1, textAlign: 'left' }}>{o.label}</span>
                {on && <Check size={13} aria-hidden />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
