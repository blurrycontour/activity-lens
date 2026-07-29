import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

/** One selectable value within a group. */
export interface FilterOption<T> {
  value: T
  label: string
  /** Optional colour dot, used for activity types. */
  color?: string
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
  value: any
  onChange: (v: any) => void
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** Downward drag, in px, past which releasing dismisses the sheet. */
const DISMISS_PX = 90

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
  // How far the sheet has been dragged down, in px. State drives the transform;
  // the ref is what touchend reads, since a state update may not have applied.
  const [drag, setDrag] = useState(0)
  const dragRef = useRef(0)
  const startY = useRef(0)
  const bodyRef = useRef<HTMLDivElement>(null)

  // A sheet is a modal surface, so Escape should dismiss it like any other.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function setDragDistance(px: number) {
    dragRef.current = px
    setDrag(px)
  }

  function onTouchStart(e: React.TouchEvent) {
    // Dragging from the option list should scroll it, not move the sheet —
    // unless it is already at the top, where there is nothing left to scroll.
    if (bodyRef.current?.contains(e.target as Node) && bodyRef.current.scrollTop > 0) {
      startY.current = -1
      return
    }
    startY.current = e.touches[0].clientY
  }

  function onTouchMove(e: React.TouchEvent) {
    if (startY.current < 0) return
    // Only downward travel moves the sheet; pulling up does nothing, so it
    // cannot be dragged taller than it is.
    const dy = Math.max(0, e.touches[0].clientY - startY.current)
    setDragDistance(dy)
  }

  function onTouchEnd() {
    if (startY.current < 0) return
    startY.current = -1
    if (dragRef.current > DISMISS_PX) onClose()
    else setDragDistance(0)
  }

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div
        className="sheet"
        role="dialog"
        aria-label="Filters"
        aria-modal="true"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        style={{
          transform: drag > 0 ? `translateY(${drag}px)` : undefined,
          // Track the finger 1:1 while dragging; ease back on release.
          transition: drag > 0 ? 'none' : undefined,
        }}
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
                {g.options.map(o => (
                  <button
                    key={String(o.value)}
                    className={`chip${o.value === g.value ? ' active' : ''}`}
                    aria-pressed={o.value === g.value}
                    onClick={() => g.onChange(o.value)}
                  >
                    {o.color && (
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: o.color, flexShrink: 0 }} />
                    )}
                    {o.label}
                  </button>
                ))}
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
