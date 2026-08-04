import { useCallback, useEffect, useRef, useState } from 'react'

/** Fraction of the viewport width a drag must cross to commit to a navigation. */
const COMMIT_FRACTION = 0.28
/** A fast flick commits regardless of distance, in px/ms. */
const FLICK_VELOCITY = 0.45
/** Minimum travel before a flick is allowed to commit, so taps never navigate. */
const FLICK_MIN_DISTANCE = 24
/** Movement needed before the gesture decides whether it is horizontal. */
const SLOP = 10
/** How much more horizontal than vertical the travel must be to take over. */
const DIRECTION_RATIO = 1.4
/** Duration of the commit / snap-back animation, in ms. Matches the CSS below. */
const ANIMATION_MS = 260

/** Where the page currently sits in the gesture lifecycle. */
export type SwipePhase =
  | 'idle'
  /** Finger down, page tracking it 1:1. */
  | 'dragging'
  /** Released without committing; page is easing back to centre. */
  | 'snapping'
  /** Committed; outgoing page is easing off-screen. */
  | 'exiting'
  /** New page is easing in from the opposite edge. */
  | 'entering'

export interface SwipeState {
  /** Horizontal offset of the page, in px. */
  offset: number
  phase: SwipePhase
  /**
   * Which way the user is heading: -1 for the previous page (dragging right),
   * 1 for the next page, 0 when there is no active gesture.
   */
  direction: -1 | 0 | 1
  /** True whenever the offset should animate rather than track the finger. */
  animating: boolean
}

const IDLE: SwipeState = { offset: 0, phase: 'idle', direction: 0, animating: false }

/**
 * Returns true when the gesture started inside something that consumes
 * horizontal drags itself — a map, or any horizontally scrollable container
 * such as the heatmap grid — so those keep their own behaviour.
 */
function startedInHorizontalScroller(target: EventTarget | null): boolean {
  let el = target instanceof Element ? target : null
  while (el && !el.classList.contains('main-content')) {
    if (el.classList.contains('maplibregl-map')) return true
    if (el.scrollWidth > el.clientWidth + 4) {
      const overflowX = getComputedStyle(el).overflowX
      if (overflowX === 'auto' || overflowX === 'scroll') return true
    }
    el = el.parentElement
  }
  return false
}

/**
 * Drives the mobile page-swipe gesture.
 *
 * The page follows the finger, then either eases off-screen and hands over to
 * the destination page, or springs back. Only one page is ever mounted: the
 * incoming page is not rendered until the outgoing one has left, which keeps
 * the animation smooth even when the destination is chart-heavy.
 *
 * `onPrev` / `onNext` are invoked at the hand-over point, between the exit and
 * enter animations.
 *
 * Takes the target element itself rather than a ref object. A plain `useRef`
 * never changes identity when its `.current` is first attached, so an effect
 * depending on the ref object alone can bind before the element exists (e.g.
 * while a loading/login screen is showing) and then never re-run once the real
 * element mounts. Passing the element as a value — typically from a
 * `useState` pair fed by a callback ref — makes that transition a real
 * dependency change.
 */
export function useSwipeNav(
  el: HTMLElement | null,
  { enabled, onPrev, onNext }: { enabled: boolean; onPrev: () => void; onNext: () => void },
): SwipeState {
  const [state, setState] = useState<SwipeState>(IDLE)
  // Handlers are bound once per enable/disable, so the latest callbacks are
  // read through a ref rather than re-binding listeners on every render.
  const navRef = useRef({ onPrev, onNext })
  navRef.current = { onPrev, onNext }
  // Timers for the two-stage commit animation, cleared on unmount so a gesture
  // interrupted by navigation cannot fire into a dead component.
  const timers = useRef<number[]>([])

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }, [])

  useEffect(() => clearTimers, [clearTimers])

  // Any change to `enabled` (opening a modal, a workout detail, resizing to
  // desktop) abandons an in-flight gesture rather than leaving the page
  // stranded off-centre.
  useEffect(() => {
    if (!enabled) {
      clearTimers()
      setState(IDLE)
    }
  }, [enabled, clearTimers])

  useEffect(() => {
    if (!enabled || !el) return
    const target = el

    let startX = 0
    let startY = 0
    let lastX = 0
    let lastT = 0
    let velocity = 0
    let active = false
    let decided = false

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1 || startedInHorizontalScroller(e.target)) {
        active = false
        return
      }
      startX = lastX = e.touches[0].clientX
      startY = e.touches[0].clientY
      lastT = e.timeStamp
      velocity = 0
      active = true
      decided = false
    }

    function onTouchMove(e: TouchEvent) {
      if (!active) return
      const x = e.touches[0].clientX
      const dx = x - startX
      const dy = e.touches[0].clientY - startY

      if (!decided) {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return
        // Vertical intent wins: let the page scroll and stay out of the way.
        if (Math.abs(dx) < Math.abs(dy) * DIRECTION_RATIO) {
          active = false
          return
        }
        decided = true
        clearTimers()
      }

      // Owning the gesture now, so stop the browser scrolling underneath.
      // Requires the non-passive touchmove listener registered below.
      e.preventDefault()

      const dt = e.timeStamp - lastT
      if (dt > 0) {
        // Exponential smoothing keeps one jittery sample from faking a flick.
        velocity = 0.7 * ((x - lastX) / dt) + 0.3 * velocity
        lastX = x
        lastT = e.timeStamp
      }
      setState({
        offset: dx,
        phase: 'dragging',
        direction: dx > 0 ? -1 : 1,
        animating: false,
      })
    }

    function onTouchEnd() {
      if (!active) return
      active = false
      if (!decided) return
      decided = false

      const width = target.clientWidth || window.innerWidth
      const dx = lastX - startX
      const far = Math.abs(dx) > width * COMMIT_FRACTION
      const flicked = Math.abs(velocity) > FLICK_VELOCITY && Math.abs(dx) > FLICK_MIN_DISTANCE
      // A flick must agree with the direction already travelled, so a drag one
      // way that snaps back the other cannot commit.
      const committed = (far || flicked) && Math.sign(velocity || dx) === Math.sign(dx)

      if (!committed) {
        setState({ offset: 0, phase: 'snapping', direction: 0, animating: true })
        timers.current.push(window.setTimeout(() => setState(IDLE), ANIMATION_MS))
        return
      }

      const direction: -1 | 1 = dx > 0 ? -1 : 1
      // Stage 1: ease the outgoing page off the edge it is heading towards.
      setState({ offset: direction === -1 ? width : -width, phase: 'exiting', direction, animating: true })
      timers.current.push(
        window.setTimeout(() => {
          // Stage 2: swap the page while it is off-screen, then place the new
          // one on the opposite edge with no transition...
          if (direction === -1) navRef.current.onPrev()
          else navRef.current.onNext()
          setState({ offset: direction === -1 ? -width : width, phase: 'entering', direction, animating: false })
          // ...and on the next frame, animate it home. Two frames, because the
          // first commits the un-transitioned position to the compositor.
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              setState({ offset: 0, phase: 'entering', direction, animating: true })
              timers.current.push(window.setTimeout(() => setState(IDLE), ANIMATION_MS))
            })
          })
        }, ANIMATION_MS),
      )
    }

    target.addEventListener('touchstart', onTouchStart, { passive: true })
    target.addEventListener('touchmove', onTouchMove, { passive: false })
    target.addEventListener('touchend', onTouchEnd, { passive: true })
    target.addEventListener('touchcancel', onTouchEnd, { passive: true })
    return () => {
      target.removeEventListener('touchstart', onTouchStart)
      target.removeEventListener('touchmove', onTouchMove)
      target.removeEventListener('touchend', onTouchEnd)
      target.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [el, enabled, clearTimers])

  return state
}

export { ANIMATION_MS as SWIPE_ANIMATION_MS }
