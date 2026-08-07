import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'

/** Finger travel, in px, at which the pull arms and will refresh on release. */
const ARM_FINGER_PX = 85
/**
 * Damping applied to finger travel before the pull arms. Below 1 the indicator
 * lags the finger, which is what makes the pull feel elastic rather than glued
 * to the thumb.
 */
const PRE_ARM_RATIO = 0.6
/**
 * Damping applied after arming. Much heavier, so the indicator visibly resists
 * further pulling instead of coasting a long way past the point where the
 * gesture has already been decided.
 */
const POST_ARM_RATIO = 0.18
/** Indicator travel at which the pull is armed. */
const ARMED_AT = ARM_FINGER_PX * PRE_ARM_RATIO
/** Hard cap on indicator travel. Reached only after a long, heavily damped tail. */
const MAX_PULL = ARMED_AT + 28
/** Vertical travel needed before we decide this is a pull and not a tap. */
const SLOP = 8
/** One full rotation of the spinner, in ms. Also the minimum time it stays up. */
const SPIN_MS = 900
/**
 * Surfaces that own their own vertical drag.
 *
 * Bottom sheets, modals and their backdrops render inline in the component
 * tree, so despite being positioned fixed they are still DOM descendants of the
 * scroll container — without this, dragging a sheet down to dismiss it bubbles
 * here and is read as a pull on the page behind it.
 *
 * A map is the same problem with a worse symptom: panning south is the most
 * ordinary thing anyone does on the map page, and every one of those drags was
 * arming the refresh indicator and dragging it down the screen.
 */
const NO_PULL_SELECTOR = '.sheet, .modal, .modal-box, .overlay, .maplibregl-map'

/**
 * Maps raw finger travel to indicator travel. Two slopes: responsive up to the
 * arming point, then stiff, so the indicator keeps moving all the way to the
 * cap without the last stretch feeling like dead travel.
 */
function dampPull(dy: number): number {
  if (dy <= ARM_FINGER_PX) return dy * PRE_ARM_RATIO
  return Math.min(MAX_PULL, ARMED_AT + (dy - ARM_FINGER_PX) * POST_ARM_RATIO)
}

interface PullToRefreshProps {
  /** The scroll container the gesture is measured against. */
  scrollEl: HTMLElement | null
  /** Disables the gesture (desktop, or while a modal owns the screen). */
  enabled: boolean
  /** Runs the refresh. The spinner spins until this settles. */
  onRefresh: () => Promise<void>
}

/**
 * Pull-to-refresh for the mobile PWA.
 *
 * Refreshes the data rather than reloading the document: a full reload would
 * re-download and re-parse the bundle and flash a blank screen, which is
 * exactly the clunkiness this is meant to avoid.
 *
 * Renders only the indicator; the gesture is bound to `scrollEl`, and only
 * starts when that container is already scrolled to the top so it can never
 * fight normal scrolling.
 *
 * Takes the element itself (typically from a callback-ref-backed `useState`)
 * rather than a `RefObject`. A plain ref's identity never changes, so an
 * effect keyed on the ref object can bind before the element exists (e.g.
 * during a loading screen) and then never notice it mount — this hook needs to
 * react to the element itself arriving.
 */
export default function PullToRefresh({ scrollEl, enabled, onRefresh }: PullToRefreshProps) {
  // Distance the indicator is pulled down, in px.
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  // Set while the finger is down and committed to a pull, so the indicator can
  // drop its CSS transition and track the finger 1:1.
  const [dragging, setDragging] = useState(false)
  // Mirrors `refreshing` for the event handlers, which are bound once and would
  // otherwise close over a stale value.
  const refreshingRef = useRef(false)
  // The authoritative pull distance. State drives rendering, but touchend has
  // to read the distance synchronously and a state updater is not guaranteed to
  // have run by then.
  const pullRef = useRef(0)

  function setPullDistance(px: number) {
    pullRef.current = px
    setPull(px)
  }

  useEffect(() => {
    if (!enabled || !scrollEl) return
    const el = scrollEl

    let startY = 0
    let active = false
    let decided = false

    function reset() {
      active = false
      decided = false
      setDragging(false)
    }

    function onTouchStart(e: TouchEvent) {
      // Only from a resting scroll position, and never mid-refresh.
      if (e.touches.length !== 1 || el.scrollTop > 0 || refreshingRef.current) {
        active = false
        return
      }
      // A drag that starts on a sheet, a modal or a map belongs to that surface.
      if (e.target instanceof Element && e.target.closest(NO_PULL_SELECTOR)) {
        active = false
        return
      }
      startY = e.touches[0].clientY
      active = true
      decided = false
    }

    function onTouchMove(e: TouchEvent) {
      if (!active) return
      const dy = e.touches[0].clientY - startY
      if (dy <= 0) {
        // Pulled back up past the origin, or scrolling down normally.
        if (decided) {
          setPullDistance(0)
          reset()
        }
        return
      }
      if (!decided) {
        if (dy < SLOP) return
        // The container may have scrolled between touchstart and now.
        if (el.scrollTop > 0) {
          active = false
          return
        }
        decided = true
        setDragging(true)
      }
      // Stop the browser treating this as a scroll (or its own overscroll
      // bounce) now that the pull owns the gesture. Requires a non-passive
      // listener, which is why touchmove is registered with passive: false.
      e.preventDefault()
      setPullDistance(dampPull(dy))
    }

    async function onTouchEnd() {
      if (!decided) {
        reset()
        return
      }
      reset()
      if (pullRef.current < ARMED_AT) {
        setPullDistance(0)
        return
      }
      // Hold the indicator at the trigger point for the duration of the refresh.
      setPullDistance(ARMED_AT)
      refreshingRef.current = true
      setRefreshing(true)
      const startedAt = Date.now()
      try {
        await onRefresh()
      } finally {
        // A warm refresh can return in tens of milliseconds, which would show
        // as a flicker rather than feedback. Hold the spinner for at least one
        // full rotation so the gesture visibly did something.
        const elapsed = Date.now() - startedAt
        if (elapsed < SPIN_MS) {
          await new Promise(resolve => setTimeout(resolve, SPIN_MS - elapsed))
        }
        refreshingRef.current = false
        setRefreshing(false)
        setPullDistance(0)
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [scrollEl, enabled, onRefresh])

  if (!enabled || (pull === 0 && !refreshing)) return null

  const armed = pull >= ARMED_AT
  // Fade and grow the indicator in over the first stretch of the pull, so it is
  // fully visible well before the arming point rather than still appearing.
  const appear = Math.min(1, pull / (ARMED_AT * 0.55))
  // Rotation is driven by the whole travel range, including the damped tail
  // past the arming point, so the icon never sits still while the finger moves.
  const spun = Math.min(1, pull / MAX_PULL)

  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 40,
        transform: `translateY(${pull}px)`,
        transition: dragging ? 'none' : 'transform 0.25s cubic-bezier(0.22, 1, 0.36, 1)',
      }}
    >
      <div
        style={{
          marginTop: 10,
          width: 38,
          height: 38,
          borderRadius: '50%',
          background: 'var(--bg-2)',
          border: `1px solid ${armed || refreshing ? 'var(--primary)' : 'var(--border)'}`,
          boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: appear,
          transform: `scale(${0.75 + appear * 0.25})`,
          transition: dragging ? 'border-color 0.15s' : 'opacity 0.2s, transform 0.2s, border-color 0.15s',
        }}
      >
        <RefreshCw
          size={20}
          strokeWidth={2.6}
          color={armed || refreshing ? 'var(--primary)' : 'var(--text-3)'}
          style={{
            // While pulling, the icon rotates with the drag; once refreshing it
            // hands over to a continuous spin.
            animation: refreshing ? `spin ${SPIN_MS}ms linear infinite` : 'none',
            transform: refreshing ? undefined : `rotate(${spun * 360}deg)`,
            transition: dragging ? 'none' : 'transform 0.2s',
          }}
        />
      </div>
    </div>
  )
}
