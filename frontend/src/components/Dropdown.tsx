import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import useEscape from '../lib/useEscape'

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
  /**
   * Marks the trigger as holding something other than its default.
   *
   * Driven by the caller because only the caller knows what the default is —
   * "All types" and "Newest first" are unremarkable, "Runs" and "Longest" are
   * a filter someone left on. Without it a narrowed list on a desktop looks
   * exactly like an empty one, which is how a filter gets forgotten.
   */
  active?: boolean
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
/** Smallest the menu may be, so a short trigger still gets readable rows. */
const MIN_MENU_WIDTH = 170

export default function Dropdown<T extends string | number>({
  value, options, onChange, icon, block, disabled, ariaLabel, placeholder, dropUp, active,
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ left: number; top?: number; bottom?: number; width: number } | null>(null)

  // A control that becomes disabled while its menu is open would leave the menu
  // stranded with no way to dismiss it.
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])

  useEffect(() => {
    function handle(e: MouseEvent) {
      const t = e.target as Node
      // The menu is portalled out of this element, so it is not inside `ref` —
      // testing only that would treat every click on an option as a click
      // outside and close the menu before the option's own handler ran.
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  /*
   * The menu is positioned against the viewport and rendered into <body>.
   *
   * An absolutely-positioned menu is clipped by any ancestor that scrolls, and
   * this control now lives inside one: the file list in a multi-file import is
   * a 320px scroll box, and a six-option menu is taller than that, so every
   * picker in it would open into a menu cut off halfway down.
   *
   * It also flips upwards on its own when there is no room below, which is what
   * the explicit `dropUp` was for. That prop still wins where a caller knows
   * better.
   */
  useLayoutEffect(() => {
    if (!open || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    const width = Math.max(r.width, MIN_MENU_WIDTH)
    const below = window.innerHeight - r.bottom
    const wantsUp = dropUp ?? (below < 240 && r.top > below)

    /*
     * Aligned to the trigger's left edge, unless that would run it off the
     * right of the screen — then to its right edge instead, so the menu opens
     * inwards. A menu is always wider than its own minimum and often wider
     * than its trigger, so a picker sitting near a right edge (the track
     * shading control, on the far side of a map or a drawing) reliably hung
     * past it. The final clamp is the backstop for a trigger so wide that
     * neither edge fits.
     */
    const margin = 8
    let left = r.left
    if (left + width > window.innerWidth - margin) left = r.right - width
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin))

    setBox(wantsUp
      ? { left, bottom: window.innerHeight - r.top + 4, width }
      : { left, top: r.bottom + 4, width })
  }, [open, dropUp])

  // Anything that moves the trigger invalidates the position. Closing is both
  // simpler and less surprising than having a menu chase its control across the
  // screen, and matches what a native select does.
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  // Escape closes it, like every other dismissible surface in the app.
  useEscape(open, () => setOpen(false))

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
        className={`al-dropdown-trigger${active ? ' active' : ''}`}
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

      {open && box && createPortal(
        <div
          ref={menuRef}
          className="al-dropdown-menu floating"
          style={{ ...box, animation: 'fadeIn 0.12s ease' }}
        >
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
        </div>,
        document.body,
      )}
    </div>
  )
}
