import { useEffect, useRef, useState } from 'react'

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

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

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
