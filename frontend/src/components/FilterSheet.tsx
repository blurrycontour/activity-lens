import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import useSheetDrag from '../lib/useSheetDrag'

/** One selectable value within a group. */
export interface FilterOption<T> {
  value: T
  label: string
  /** Optional colour dot, for options with no glyph of their own. */
  color?: string
  /** Mark before the label. Replaces the dot, which it already carries the colour of. */
  glyph?: React.ReactNode
}

/**
 * A group of mutually exclusive options, rendered as a wrapping row of chips.
 * Typed loosely because a sheet holds groups of differing value types; each
 * group is built by a type-safe helper at the call site.
 */
export interface FilterGroup {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  key: string
  label: string
  options: FilterOption<any>[]
  /**
   * The chosen value, or — when `multi` is set — the array of chosen values.
   * Tapping an option in a multi group toggles it rather than replacing the
   * selection, and `onChange` is handed the option, not the new array: the
   * group does not know what the caller stores it in.
   */
  value: any
  onChange: (v: any) => void
  /* eslint-enable @typescript-eslint/no-explicit-any */
  /** Several options may be on at once, and they narrow together. */
  multi?: boolean
  /**
   * A third state for options that can also be *excluded*, which "on or off"
   * cannot express. The sheet only draws it; what the states mean, and what
   * tapping does next, belong to the caller.
   */
  state?: (value: unknown) => 'on' | 'excluded' | undefined
}

interface FilterSheetProps {
  groups: FilterGroup[]
  onClose: () => void
  /** Restores every group to its default; hidden when nothing is applied. */
  onReset?: () => void
}

/**
 * Bottom sheet holding the filters that are dropdowns on desktop. Three 150px
 * dropdowns wrap to three rows on a phone, which pushed the actual list below
 * the fold — here every option is visible at a comfortable tap size instead,
 * and the page header collapses to a single row.
 */
export default function FilterSheet({ groups, onClose, onReset }: FilterSheetProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const sheet = useSheetDrag(onClose, bodyRef)

  // A sheet is a modal surface, so Escape should dismiss it like any other.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div
        className="sheet"
        role="dialog"
        aria-label="Filters"
        aria-modal="true"
        {...sheet.handlers}
        style={sheet.style}
      >
        <div className="sheet-grab" aria-hidden="true" />
        <div className="sheet-head">
          <h3 style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>Filters</h3>
          {onReset && (
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={onReset}>
              Reset
            </button>
          )}
          <button className="btn-icon" onClick={onClose} aria-label="Close filters"><X size={16} /></button>
        </div>

        <div className="sheet-body" ref={bodyRef}>
          {groups.map(g => (
            <div key={g.key} className="sheet-group">
              <div className="sheet-group-label">{g.label}</div>
              <div className="chip-row" role="group" aria-label={g.label}>
                {g.options.map(o => {
                  const state = g.state?.(o.value)
                  const on = state !== undefined
                    ? true
                    : g.multi
                      ? Array.isArray(g.value) && g.value.includes(o.value)
                      : o.value === g.value
                  return (
                  <button
                    key={String(o.value)}
                    className={`chip${on ? ' active' : ''}${state === 'excluded' ? ' excluded' : ''}`}
                    aria-pressed={on}
                    onClick={() => g.onChange(o.value)}
                  >
                    {o.glyph ?? (o.color && (
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: o.color, flexShrink: 0 }} />
                    ))}
                    {o.label}
                  </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Filters apply as you tap, so this only dismisses. */}
        <div className="sheet-foot">
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </>
  )
}
