import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'

export interface DialAction {
  id: string
  /** What it makes, in a word or two. Sits beside the button. */
  label: string
  icon: React.ReactNode
  onSelect: () => void
}

/**
 * A floating button that makes one of several things.
 *
 * Every page that creates something has a single floating button, because it
 * creates exactly one kind of thing. The dashboard is the page that is about
 * everything, so the button there has to ask what — and asking with a menu
 * would be a dropdown in the corner of the screen furthest from where menus
 * live. This is the shape the platform already uses for it: the actions come
 * up the same edge the button sits on, each with its name beside it.
 *
 * Collapsed it is the same `.fab` every other page draws, in the same place, so
 * moving between them does not move the button.
 */
export default function SpeedDial({ actions, label }: {
  actions: DialAction[]
  /** What the closed button says it does, for a screen reader and a tooltip. */
  label: string
}) {
  const [open, setOpen] = useState(false)

  // Escape closes it, like every other transient thing in the app.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      {/* A tap anywhere else closes it, over a page pushed back far enough to
          read three circles against — a dashboard is charts and numbers edge
          to edge, and unblurred there was nothing for them to sit on. */}
      {open && <div className="dial-scrim" onClick={() => setOpen(false)} aria-hidden />}

      <div className={`dial${open ? ' open' : ''}`}>
        {/* Rendered even when closed, so opening animates from the button
            rather than appearing whole. Taken out of the tab order and hidden
            from screen readers while closed, since they are not choices yet. */}
        <div className="dial-actions" aria-hidden={!open}>
          {actions.map((a, i) => (
            <button
              key={a.id}
              type="button"
              className="dial-action"
              tabIndex={open ? 0 : -1}
              // Staggered from the bottom up, so they read as coming out of
              // the button rather than arriving as a block.
              style={{ transitionDelay: open ? `${(actions.length - 1 - i) * 35}ms` : '0ms' }}
              onClick={() => { setOpen(false); a.onSelect() }}
            >
              <span className="dial-label">{a.label}</span>
              <span className="dial-glyph">{a.icon}</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          className="fab dial-toggle"
          onClick={() => setOpen(o => !o)}
          title={open ? 'Close' : label}
          aria-label={open ? 'Close' : label}
          aria-expanded={open}
        >
          {/* The same mark at the same weight as every other page's button.
              It was drawn at three different weights across four pages, which
              is not four icons -- it is one icon looking slightly wrong on
              three of them. This is the lighter of the two, which is what the
              rest of the app's icons are set at. */}
          {open ? <X size={24} /> : <Plus size={24} />}
        </button>
      </div>
    </>
  )
}
