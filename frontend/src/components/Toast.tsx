import { useEffect } from 'react'
import { createPortal } from 'react-dom'

/** How long it stays. Long enough to read six words, short enough not to nag. */
const AUTO_DISMISS_MS = 2600

/**
 * A brief message near the top of the screen, for something that just worked.
 *
 * The app had two ways of saying so and neither fits a small confirmation: a
 * status line under a form, which needs a form to sit under, and the push
 * banner, which is a notification with an icon, a body and a tap target. This
 * is the third case — a ping sent, something saved — where the whole message is
 * four words and the only thing it has to do is appear and go away.
 *
 * Portalled and positioned like the banner it borrows its manners from, so
 * whatever is on screen underneath cannot bound it or paint over it.
 */
export default function Toast({ message, icon, onDone }: {
  message: string
  /** A small mark before the text; the tick, an avatar, nothing at all. */
  icon?: React.ReactNode
  onDone: () => void
}) {
  useEffect(() => {
    const id = setTimeout(onDone, AUTO_DISMISS_MS)
    return () => clearTimeout(id)
  }, [onDone])

  return createPortal(
    // Polite rather than assertive: this reports something the user just did
    // and already knows about, so it waits its turn with a screen reader
    // instead of interrupting.
    <div className="toast" role="status" aria-live="polite">
      {icon}
      <span>{message}</span>
    </div>,
    document.body,
  )
}
