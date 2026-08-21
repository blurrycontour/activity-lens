import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

/** How long it stays. Long enough to read four words, short enough not to nag. */
const AUTO_DISMISS_MS = 1500

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
export default function Toast({ message, icon, duration = AUTO_DISMISS_MS, onDone }: {
  message: string
  /** A small mark before the text; the tick, an avatar, nothing at all. */
  icon?: React.ReactNode
  /** Milliseconds on screen. */
  duration?: number
  onDone: () => void
}) {
  /*
   * The callback through a ref, and the timer started once.
   *
   * Callers write `onDone={() => setX(null)}`, which is a new function on every
   * render — and a timer effect that depends on it restarts on every render of
   * the parent. The ping row re-renders once a second while a cooldown runs, so
   * the toast's dismissal was pushed back a second, every second, and it stayed
   * until the cooldown ended.
   */
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    const id = setTimeout(() => done.current(), duration)
    return () => clearTimeout(id)
  }, [duration])

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
