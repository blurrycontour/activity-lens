import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Cloud, Footprints, Heart, Image, MapPin, MessageSquare, NotebookPen, SlidersHorizontal, X } from 'lucide-react'
import { hasKey, isNegated, type Has, type HasFilter } from '../lib/workoutFilters'
import useEscape from '../lib/useEscape'

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
  { value: 'cadence', label: 'Cadence', glyph: <Footprints size={14} /> },
  { value: 'comments', label: 'Comments', glyph: <MessageSquare size={14} /> },
  { value: 'weather', label: 'Weather', glyph: <Cloud size={14} /> },
  { value: 'notes', label: 'Notes', glyph: <NotebookPen size={14} />, ownerOnly: true },
]

/** The options a list may offer, given whose workouts it holds. */
export function containsOptions(mine: boolean): ContainsOption[] {
  return mine ? CONTAINS_OPTIONS : CONTAINS_OPTIONS.filter(o => !o.ownerOnly)
}

/** The label for one filter, for the chip that says it is applied. */
export function containsLabel(v: HasFilter): string {
  const label = CONTAINS_OPTIONS.find(o => o.value === hasKey(v))?.label ?? hasKey(v)
  return isNegated(v) ? `No ${label.toLowerCase()}` : label
}

/**
 * The next state for an attribute, cycling with → without → off.
 *
 * A cycle rather than two controls: the three states are answers to one
 * question — "photos?" — and splitting them into a "has" list and a "hasn't"
 * list would let someone tick both and get an empty page with no clue why.
 */
export function cycleHas(current: HasFilter[], k: Has): HasFilter[] {
  const rest = current.filter(f => hasKey(f) !== k)
  const existing = current.find(f => hasKey(f) === k)
  if (existing === undefined) return [...rest, k]
  if (!isNegated(existing)) return [...rest, `no-${k}` as HasFilter]
  return rest
}

/**
 * The options for the phone's filter sheet, labelled for their current state.
 *
 * Built here so the sheet and the dropdown offer the same set in the same
 * order, and so "No photos" is worded once.
 */
export function containsSheetOptions(mine: boolean, value: HasFilter[]) {
  return containsOptions(mine).map(o => {
    const state = value.find(f => hasKey(f) === o.value)
    return {
      value: o.value,
      label: state !== undefined ? containsLabel(state) : o.label,
      glyph: o.glyph,
    }
  })
}

/** How one option currently stands, for the sheet's three-state chip. */
export function containsState(value: HasFilter[], v: unknown): 'on' | 'excluded' | undefined {
  const state = value.find(f => hasKey(f) === v)
  if (state === undefined) return undefined
  return isNegated(state) ? 'excluded' : 'on'
}

/**
 * A dropdown holding several independent on/off (or on/excluded/off) options.
 *
 * Its own component rather than a mode on Dropdown, which closes on choosing
 * and shows one value — both wrong here, where the point is to tick two things
 * and see them both. It borrows Dropdown's classes so it sits in a filter row
 * as one of the same controls.
 *
 * Generic over what the options mean, because there are now two of these: the
 * workout "contains" filter below, and the plan/session one in ItemFilterBar.
 * They differ only in their option list and whether a third "without" state is
 * offered, which is exactly what `state` and `onToggle` leave to the caller.
 */
export function MultiDropdown<T extends string>({
  label, icon, options, count, state, onToggle, describe,
}: {
  /** Trigger text when nothing is chosen. */
  label: string
  icon?: React.ReactNode
  options: { value: T; label: string; glyph?: React.ReactNode }[]
  /** How many are on, for the trigger. */
  count: number
  /** How one option currently stands. */
  state: (v: T) => 'on' | 'excluded' | undefined
  onToggle: (v: T) => void
  /** Tooltip for an option, given its state. */
  describe?: (o: { value: T; label: string }, state: 'on' | 'excluded' | undefined) => string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Click-away and Escape, the same pair every menu in the app closes on.
  useEscape(open, () => setOpen(false))
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div className="al-dropdown" ref={ref}>
      <button
        type="button"
        className={`al-dropdown-trigger${count > 0 ? ' active' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
      >
        {icon ?? <SlidersHorizontal size={14} color="var(--text-3)" aria-hidden />}
        {/* The count rather than the names: two or three labels would not fit,
            and a trigger that changes width as you tick things is worse than
            one that says how many. */}
        <span>{count === 0 ? label : `${label} (${count})`}</span>
        <ChevronDown size={13} style={{ marginLeft: 'auto', flexShrink: 0 }} aria-hidden />
      </button>
      {open && (
        <div className="al-dropdown-menu" role="listbox" aria-multiselectable>
          {options.map(o => {
            const st = state(o.value)
            const without = st === 'excluded'
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={st !== undefined}
                className={`al-dropdown-item${st !== undefined ? ' active' : ''}`}
                // Deliberately does not close: ticking one of several is the
                // whole point, and a menu that shut each time would take four
                // clicks to say "photos and heart rate".
                onClick={() => onToggle(o.value)}
                title={describe?.(o, st)}
              >
                {o.glyph}
                <span style={{ flex: 1, textAlign: 'left' }}>{without ? `No ${o.label.toLowerCase()}` : o.label}</span>
                {/* A tick for "must have", a cross for "must not" — the state
                    has to be readable without hovering for the tooltip. */}
                {st !== undefined && (without
                  ? <X size={13} color="var(--danger)" aria-hidden />
                  : <Check size={13} aria-hidden />)}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** The desktop half of the workout "contains" filter, over CONTAINS_OPTIONS. */
export default function ContainsDropdown({ value, onToggle, mine }: {
  value: HasFilter[]
  /** Called with the attribute that was clicked; the caller owns the array. */
  onToggle: (v: Has) => void
  /** Whether these are the caller's own workouts, which unlocks Notes. */
  mine: boolean
}) {
  return (
    <MultiDropdown<Has>
      label="Contains"
      options={containsOptions(mine)}
      count={value.length}
      state={v => containsState(value, v)}
      onToggle={onToggle}
      describe={(o, st) => st === undefined
        ? `Only workouts with ${o.label.toLowerCase()}`
        : st === 'excluded' ? 'Click to clear' : `Click again for workouts without ${o.label.toLowerCase()}`}
    />
  )
}
