import { useEffect, useRef } from 'react'

/**
 * Makes an overlay close on Escape and on the system back gesture.
 *
 * Back is the interesting half. On a phone there is no visible close affordance
 * worth hunting for, and the back swipe is what everyone reaches for — but
 * nothing in the page knows an overlay is up, so the app's own router handled it
 * and navigated away, dropping the user a whole page back from where they were.
 *
 * A pushed history entry is what turns that into "never mind": while the overlay
 * is open there is one extra entry to consume, and back consumes it instead of a
 * real one. Closing any other way pops that entry back off, so the history does
 * not grow an unusable step for every time the overlay was opened. Same trick as
 * the selection mode in Workouts.
 *
 * @param open      whether the overlay is currently up
 * @param onDismiss called once, when back or Escape asks it to close
 */
export default function useDismissOnBack(open: boolean, onDismiss: () => void) {
  // Held in a ref so a caller passing a fresh closure each render does not tear
  // the history entry down and push a new one on every render.
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss

  useEffect(() => {
    if (!open) return

    let ours = true
    window.history.pushState({ overlay: true }, '', window.location.href)

    const onPop = () => {
      // The entry is already gone; going back again would leave the page.
      ours = false
      dismiss.current()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      dismiss.current()
    }
    window.addEventListener('popstate', onPop)
    document.addEventListener('keydown', onKey)

    return () => {
      window.removeEventListener('popstate', onPop)
      document.removeEventListener('keydown', onKey)
      // Closed by anything other than back — the close button, Escape, a state
      // change elsewhere — so our entry is still on the stack and has to go.
      if (ours) window.history.back()
    }
  }, [open])
}
