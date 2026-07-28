import { useEffect, useRef, useState, type RefObject } from 'react'
import { RefreshCw } from 'lucide-react'

/** How far the finger must travel before the pull commits to a refresh. */
const TRIGGER_DISTANCE = 72
/** Cap on how far the indicator travels, so a long drag doesn't run off-screen. */
const MAX_PULL = 110
/**
 * Damping applied to finger travel. Below 1 the indicator lags the finger,
 * which is what makes the pull feel elastic rather than stuck to the thumb.
 */
const RESISTANCE = 0.5
/** Vertical travel needed before we decide this is a pull and not a tap. */
const SLOP = 8
/** Indicator travel at which the pull is armed, i.e. TRIGGER_DISTANCE damped. */
const ARMED_AT = TRIGGER_DISTANCE * RESISTANCE

interface PullToRefreshProps {
  /** The scroll container the gesture is measured against. */
  scrollRef: RefObject<HTMLElement | null>
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
 * Renders only the indicator; the gesture is bound to `scrollRef`, and only
 * starts when that container is already scrolled to the top so it can never
 * fight normal scrolling.
 */
export default function PullToRefresh({ scrollRef, enabled, onRefresh }: PullToRefreshProps) {
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
    const el = scrollRef.current
    if (!enabled || !el) return

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
      if (e.touches.length !== 1 || el!.scrollTop > 0 || refreshingRef.current) {
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
        if (el!.scrollTop > 0) {
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
      setPullDistance(Math.min(MAX_PULL, dy * RESISTANCE))
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
      try {
        await onRefresh()
      } finally {
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
  }, [scrollRef, enabled, onRefresh])

  if (!enabled || (pull === 0 && !refreshing)) return null

  const armed = pull >= ARMED_AT
  // Fade and grow the indicator in as it is pulled, so it doesn't pop.
  const progress = Math.min(1, pull / ARMED_AT)

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
          marginTop: 8,
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: 'var(--bg-2)',
          border: '1px solid var(--border)',
          boxShadow: '0 2px 10px rgba(0,0,0,0.28)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: progress,
          transform: `scale(${0.7 + progress * 0.3})`,
          transition: dragging ? 'none' : 'opacity 0.2s, transform 0.2s',
        }}
      >
        <RefreshCw
          size={16}
          color={armed || refreshing ? 'var(--primary)' : 'var(--text-3)'}
          style={{
            // While pulling, the icon rotates with the drag; once refreshing it
            // hands over to a continuous spin.
            animation: refreshing ? 'spin 0.8s linear infinite' : 'none',
            transform: refreshing ? undefined : `rotate(${progress * 270}deg)`,
            transition: dragging ? 'none' : 'transform 0.2s',
          }}
        />
      </div>
    </div>
  )
}
