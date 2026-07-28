import { useEffect, type RefObject } from 'react'

/** Minimum horizontal travel, in px, before a touch counts as a page swipe. */
const MIN_DISTANCE = 70
/** How much more horizontal than vertical the travel must be, so that
 * scrolling the page never trips a navigation. */
const DIRECTION_RATIO = 1.8
/** Slow drags are the user reading, not navigating. */
const MAX_DURATION_MS = 700

/**
 * Returns true when the gesture started inside something that consumes
 * horizontal drags itself — a map, or any horizontally scrollable container
 * such as the heatmap grid — so those keep their own behaviour.
 */
function startedInHorizontalScroller(target: EventTarget | null): boolean {
  let el = target instanceof Element ? target : null
  while (el && !el.classList.contains('main-content')) {
    if (el.classList.contains('leaflet-container')) return true
    if (el.scrollWidth > el.clientWidth + 4) {
      const overflowX = getComputedStyle(el).overflowX
      if (overflowX === 'auto' || overflowX === 'scroll') return true
    }
    el = el.parentElement
  }
  return false
}

/**
 * Wires left/right swipe gestures on `ref` to page navigation, used on mobile
 * to move between the bottom-bar pages. Swiping right (content follows the
 * finger) goes to the previous page, matching how paged mobile UIs behave.
 */
export function useSwipeNav(
  ref: RefObject<HTMLElement | null>,
  { enabled, onPrev, onNext }: { enabled: boolean; onPrev: () => void; onNext: () => void },
) {
  useEffect(() => {
    const el = ref.current
    if (!enabled || !el) return

    let startX = 0
    let startY = 0
    let startedAt = 0
    let tracking = false

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1 || startedInHorizontalScroller(e.target)) {
        tracking = false
        return
      }
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
      startedAt = Date.now()
      tracking = true
    }

    function onTouchEnd(e: TouchEvent) {
      if (!tracking) return
      tracking = false
      const touch = e.changedTouches[0]
      if (!touch || Date.now() - startedAt > MAX_DURATION_MS) return
      const dx = touch.clientX - startX
      const dy = touch.clientY - startY
      if (Math.abs(dx) < MIN_DISTANCE || Math.abs(dx) < Math.abs(dy) * DIRECTION_RATIO) return
      if (dx > 0) onPrev()
      else onNext()
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [ref, enabled, onPrev, onNext])
}
