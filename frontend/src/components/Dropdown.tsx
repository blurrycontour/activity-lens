import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export interface DropdownOption<T> {
  value: T
  label: string
  /** Short mono prefix in the menu, e.g. an arrow or "7d". */
  short?: string
  /**
   * Colour of the label when selected, and of the dot before it.
   *
   * The dot is the fallback mark: an option carrying a `glyph` already shows
   * its colour through the icon, so it does not get one as well.
   */
  color?: string
  /** Small mark shown before the label, in both trigger and menu. */
  glyph?: React.ReactNode
}

interface DropdownProps<T extends string | number> {
  value: T
  options: DropdownOption<T>[]
  onChange: (v: T) => void
  /** Icon at the far left of the trigger. Omit when options carry colour dots. */
  icon?: React.ReactNode
  /** Fill the available width, for use inside a form field. */
  block?: boolean
  /**
   * Fixed trigger label, for a menu that acts rather than holds a value —
   * "+ Add equipment…" stays itself after every pick. Suppresses the tick and
   * the active row with it, since nothing here is selected.
   */
  placeholder?: string
  /** Open upwards, for a trigger too near the bottom of its container. */
  dropUp?: boolean
  disabled?: boolean
  ariaLabel?: string
}

/**
 * The app's filter/sort picker.
 *
 * A native `<select>` cannot carry a colour dot or a mono prefix, which is why
 * this exists. It replaces three components (type, sort, range) that were the
 * same eighty lines of open/close/outside-click with different options in the
 * middle — the sort of divergence that ends with three dropdowns that no longer
 * look alike.
 */
export default function Dropdown<T extends string | number>({
  value, options, onChange, icon, block, disabled, ariaLabel, placeholder, dropUp,
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // A control that becomes disabled while its menu is open would leave the menu
  // stranded with no way to dismiss it.
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  // Escape closes it, like every other dismissible surface in the app.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const selected = options.find(o => o.value === value) ?? options[0]
  if (!selected) return null

  const dot = (o: DropdownOption<T>, size: number, glow: boolean) => (
    <span style={{
      width: size, height: size, borderRadius: '50%', background: o.color,
      flexShrink: 0, boxShadow: glow ? `0 0 6px ${o.color}` : 'none',
    }} />
  )

  return (
    <div className={`al-dropdown${block ? ' block' : ''}${dropUp ? ' drop-up' : ''}`} ref={ref}>
      <button
        className="al-dropdown-trigger"
        onClick={() => setOpen(o => !o)}
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        {icon}
        {!placeholder && selected.color && !selected.glyph && dot(selected, 10, true)}
        <span style={{ flex: 1, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 6 }}>
          {placeholder ?? <>{selected.glyph}{selected.label}</>}
        </span>
        <ChevronDown
          size={14}
          color="var(--text-3)"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
        />
      </button>

      {open && (
        <div className="al-dropdown-menu" style={{ animation: 'fadeIn 0.12s ease' }}>
          {options.map(o => (
            <button
              key={String(o.value)}
              className={`al-dropdown-item ${!placeholder && value === o.value ? 'active' : ''}`}
              onClick={() => { onChange(o.value); setOpen(false) }}
            >
              {o.short !== undefined && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', width: 28, flexShrink: 0 }}>
                  {o.short}
                </span>
              )}
              {o.color && !o.glyph && dot(o, 10, false)}
              <span style={{ color: !placeholder && value === o.value ? o.color : undefined, display: 'flex', alignItems: 'center', gap: 6 }}>
                {o.glyph}
                {o.label}
              </span>
              {!placeholder && value === o.value && (
                <Check size={13} style={{ marginLeft: 'auto', flexShrink: 0 }} color={o.color ?? 'var(--primary)'} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
