import { useEffect, useRef } from 'react'

/**
 * Every overlay currently open, oldest first, and whether a guard entry is on
 * the history stack for them.
 *
 * There is exactly one guard entry however many overlays are stacked, and the
 * topmost overlay is the only one that responds to anything. Both parts are
 * needed, and the reasons are different:
 *
 *   - `popstate` and `keydown` are window-wide, so without the stack every open
 *     overlay hears every back press and every Escape, and one gesture closes
 *     the lot.
 *   - one entry per overlay looks correct and is not: closing the top one has
 *     to pop its own entry, and that pop is indistinguishable from a back press
 *     to the overlay underneath — which promptly closes too. Sharing a single
 *     entry, re-armed as each layer goes, means nothing pops until the last one
 *     is gone.
 */
let stack: symbol[] = []
let guarded = false

/** Fired whenever the overlay stack changes, so other UI (e.g. the dashboard
 *  confetti) can stay out of the way of an open dialog. */
export const OVERLAY_EVENT = 'al-overlay-change'

/** Whether any Modal-backed overlay is currently open. */
export function overlaysOpen(): boolean {
  return stack.length > 0
}

function notifyOverlayChange() {
  window.dispatchEvent(new Event(OVERLAY_EVENT))
}

/**
 * The pending removal of the guard entry, if the last overlay has just closed.
 *
 * Deferred by a tick, and cancelled if something opens in the meantime, because
 * one surface very often replaces another: picking "About" from the user menu
 * closes the menu and opens a dialog in the same commit. Popping immediately
 * meant `history.back()` — which is asynchronous — delivered its popstate after
 * the dialog had mounted and registered, and the dialog dismissed itself before
 * it was ever seen. Handing the still-armed entry over instead is both correct
 * and one fewer history round trip.
 */
let unguard: ReturnType<typeof setTimeout> | null = null

/** Puts the guard entry back without firing popstate. */
function arm() {
  window.history.pushState({ overlay: true }, '', window.location.href)
  guarded = true
}

/**
 * Makes an overlay close on Escape and on the system back gesture.
 *
 * Back is the interesting half. On a phone there is no visible close affordance
 * worth hunting for, and the back swipe is what everyone reaches for — but
 * nothing in the page knows an overlay is up, so the app's own router handled it
 * and navigated away, dropping the user a whole page back from where they were.
 *
 * A pushed history entry is what turns that into "never mind": while anything is
 * open there is one extra entry to consume, and back consumes it instead of a
 * real one. Closing any other way pops it back off, so the history does not grow
 * a dead step for every time an overlay was opened. Same trick as the selection
 * mode in Workouts.
 *
 * Nearly every caller gets this through `Modal`, which owns it for all of them.
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

    const id = Symbol('overlay')
    stack.push(id)
    notifyOverlayChange()
    // Taking over from a surface that closed in this same commit: its entry is
    // still armed, so inherit it rather than letting it be popped.
    if (unguard !== null) {
      clearTimeout(unguard)
      unguard = null
    }
    if (!guarded) arm()

    const topmost = () => stack[stack.length - 1] === id

    const onPop = () => {
      if (!topmost()) return
      stack.pop()
      notifyOverlayChange()
      // Another layer is still up, so the guard has to go back on for it. When
      // this was the last one the entry has served its purpose and is spent.
      if (stack.length > 0) arm()
      else guarded = false
      dismiss.current()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !topmost()) return
      e.stopPropagation()
      dismiss.current()
    }
    window.addEventListener('popstate', onPop)
    document.addEventListener('keydown', onKey)

    return () => {
      window.removeEventListener('popstate', onPop)
      document.removeEventListener('keydown', onKey)

      // Still listed means this closed by something other than back — a close
      // button, Escape, a state change elsewhere — so the stack has to be
      // tidied by hand. Back has already done it above.
      const i = stack.indexOf(id)
      if (i === -1) return
      stack.splice(i, 1)
      notifyOverlayChange()

      // The last one out takes the guard entry with it — after a tick, so a
      // surface opening in its place can claim it instead.
      if (stack.length === 0 && guarded && unguard === null) {
        unguard = setTimeout(() => {
          unguard = null
          if (stack.length > 0) return
          guarded = false
          // Unless something has been pushed on top of it since: a notification
          // banner sits above the overlay and can navigate while a dialog is
          // open, and going back then would undo that navigation rather than
          // tidying up after ourselves.
          if ((window.history.state as { overlay?: boolean } | null)?.overlay) {
            window.history.back()
          }
        }, 0)
      }
    }
  }, [open])
}
