import { useEffect, useRef, useState } from 'react'
import useEscape from '../lib/useEscape'

/**
 * An icon button that opens a small menu of actions beneath it.
 *
 * Children are `<button className="options-menu-item">` rows. The menu closes
 * on any click inside it, so an item never has to close it by hand — every row
 * here is an action, and one that left the menu open would be the odd one out.
 *
 * Clicks are stopped at the wrapper: these menus sit inside clickable cards,
 * where opening the menu would otherwise also open the card behind it.
 */
export default function MenuButton({ icon, label, children }: {
  icon: React.ReactNode
  /** Accessible name for the trigger, e.g. "Workout options". */
  label: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEscape(open, () => setOpen(false))

  useEffect(() => {
    if (!open) return

    /**
     * Closes on a click anywhere else, and swallows that click.
     *
     * Both halves in one handler, in the capture phase, on purpose. These
     * menus sit inside clickable workout cards, so a click that only dismissed
     * the menu went on to open the workout underneath it. Capture runs before
     * the card's own handler, which is the only place the click can still be
     * stopped; and closing anywhere earlier — on pointerdown, say — would tear
     * this listener down before the click it needs to swallow ever arrived.
     */
    function onClick(e: MouseEvent) {
      if (ref.current?.contains(e.target as Node)) return
      e.stopPropagation()
      e.preventDefault()
      setOpen(false)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [open])

  return (
    <div className="options-menu-wrap" ref={ref} onClick={e => e.stopPropagation()}>
      <button
        className="btn-icon"
        onClick={() => setOpen(o => !o)}
        title={label}
        aria-label={label}
        aria-expanded={open}
      >
        {icon}
      </button>
      {open && (
        <div
          className="options-menu"
          style={{ animation: 'fadeIn 0.12s ease' }}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  )
}
