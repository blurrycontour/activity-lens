import { useRef, useState, type RefObject } from 'react'

/** Downward drag, in px, past which releasing dismisses the sheet. */
const DISMISS_PX = 90

/**
 * Swipe-down-to-dismiss for a bottom sheet.
 *
 * A sheet that shows a grab handle and does not answer a downward swipe is
 * making a promise it does not keep: the handle is the affordance, and on a
 * phone pulling it down is the first thing anyone tries. Shared rather than
 * written per sheet, because it had been written once, for the filters, and the
 * next sheet quietly did without it.
 *
 * Pass the scrolling element when the sheet has one. A drag that starts inside
 * a list that is scrolled down belongs to the list; only from its top does the
 * gesture become the sheet's.
 */
export default function useSheetDrag(onClose: () => void, scrollRef?: RefObject<HTMLElement | null>) {
  // How far the sheet has been dragged down, in px. State drives the transform;
  // the ref is what touchend reads, since a state update may not have applied.
  const [drag, setDrag] = useState(0)
  const dragRef = useRef(0)
  // -1 means this touch is not ours.
  const startY = useRef(-1)

  function setDistance(px: number) {
    dragRef.current = px
    setDrag(px)
  }

  function onTouchStart(e: React.TouchEvent) {
    const scroller = scrollRef?.current
    if (scroller?.contains(e.target as Node) && scroller.scrollTop > 0) {
      startY.current = -1
      return
    }
    startY.current = e.touches[0].clientY
  }

  function onTouchMove(e: React.TouchEvent) {
    if (startY.current < 0) return
    // Only downward travel moves the sheet; pulling up does nothing, so it
    // cannot be dragged taller than it is.
    setDistance(Math.max(0, e.touches[0].clientY - startY.current))
  }

  function onTouchEnd() {
    if (startY.current < 0) return
    startY.current = -1
    if (dragRef.current > DISMISS_PX) onClose()
    else setDistance(0)
  }

  return {
    handlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel: onTouchEnd,
    },
    style: {
      transform: drag > 0 ? `translateY(${drag}px)` : undefined,
      // Track the finger 1:1 while dragging; ease back on release.
      transition: drag > 0 ? 'none' : undefined,
    } as React.CSSProperties,
  }
}
