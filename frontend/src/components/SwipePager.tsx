import { type ReactNode } from 'react'
import { adjacentPage, type Page } from '../lib/nav'
import { SWIPE_ANIMATION_MS, type SwipeState } from '../lib/useSwipeNav'
import { PAGE_META } from './Sidebar'

interface SwipePagerProps {
  page: Page
  swipe: SwipeState
  children: ReactNode
}

/** Easing for both the commit and the snap-back: quick out, gentle settle. */
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

/**
 * Renders the current page as the moving surface of the swipe gesture, with a
 * card naming the destination revealed underneath.
 *
 * The destination card shows the page's icon and name rather than its real
 * content: mounting a second page mid-gesture would run Recharts layout and the
 * derived analytics exactly when the animation needs the main thread, which is
 * the one thing guaranteed to make the swipe feel worse, not better.
 */
export default function SwipePager({ page, swipe, children }: SwipePagerProps) {
  const { offset, phase, direction, animating } = swipe
  const active = phase !== 'idle'

  // While entering, the page moving on screen is already the destination, so
  // there is nothing left to hint at.
  const hintPage = direction !== 0 && phase !== 'entering' ? adjacentPage(page, direction) : null
  const meta = hintPage ? PAGE_META[hintPage] : null

  return (
    <>
      {meta && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            // Sits against the edge the incoming page will arrive from.
            [direction === -1 ? 'left' : 'right']: 0,
            width: '46%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            zIndex: 0,
            // Fades and settles in as the drag approaches the commit point.
            opacity: Math.min(1, Math.abs(offset) / 90),
            transition: animating ? `opacity ${SWIPE_ANIMATION_MS}ms ${EASE}` : 'none',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              padding: '18px 22px',
              borderRadius: 16,
              background: 'var(--bg-2)',
              border: '1px solid var(--border)',
              color: 'var(--text-3)',
              // Grows slightly towards full size as the drag progresses.
              transform: `scale(${0.86 + Math.min(1, Math.abs(offset) / 160) * 0.14})`,
              transition: animating ? `transform ${SWIPE_ANIMATION_MS}ms ${EASE}` : 'none',
            }}
          >
            {meta.icon(26)}
            <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>{meta.label}</span>
          </div>
        </div>
      )}
      <div
        style={{
          // Only paint a moving layer while a gesture is running: an always-on
          // transform would promote the whole page to its own compositor layer
          // and can blur text on some Android devices.
          transform: active ? `translate3d(${offset}px, 0, 0)` : undefined,
          transition: animating ? `transform ${SWIPE_ANIMATION_MS}ms ${EASE}` : 'none',
          // Keeps the moving page above the hint card and opaque over it.
          position: 'relative',
          zIndex: 1,
          background: active ? 'var(--bg)' : undefined,
          minHeight: active ? '100%' : undefined,
          willChange: active ? 'transform' : undefined,
        }}
      >
        {children}
      </div>
    </>
  )
}
