import { useCallback, useRef } from 'react'

/** How long a press has to last. Long enough not to fire on a tap, short enough to feel deliberate. */
const HOLD_MS = 500

/** How far a finger may drift before it counts as a scroll rather than a press. */
const SLOP_PX = 10

/**
 * Press and hold, on a phone and with a mouse alike.
 *
 * Pointer events rather than touch events, which is what makes one handler cover
 * both: a long tap and a long left-click arrive here identically, so the desktop
 * gets the gesture for free instead of needing a second affordance.
 *
 * The movement guard is the part that matters on a phone. A list is something
 * people scroll, and without it every scroll that begins on a row and pauses for
 * half a second would drop the user into selection mode.
 */
export function useLongPress(onLongPress: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const origin = useRef({ x: 0, y: 0 })
  // Set when the gesture fires, so the click that follows the release can be
  // swallowed — otherwise a long press both selects the row and opens it.
  const fired = useRef(false)

  const cancel = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Left button and touch only: a right-click is the platform's own menu.
    if (e.button !== 0) return
    origin.current = { x: e.clientX, y: e.clientY }
    fired.current = false
    cancel()
    timer.current = setTimeout(() => {
      fired.current = true
      onLongPress()
    }, HOLD_MS)
  }, [cancel, onLongPress])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!timer.current) return
    const moved = Math.abs(e.clientX - origin.current.x) + Math.abs(e.clientY - origin.current.y)
    if (moved > SLOP_PX) cancel()
  }, [cancel])

  /** True when the click now arriving is the tail of a long press. */
  const consumedClick = useCallback(() => {
    if (!fired.current) return false
    fired.current = false
    return true
  }, [])

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
      // A long press on a touch screen otherwise raises the platform's own
      // text-selection menu over the top of ours.
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    },
    consumedClick,
  }
}
