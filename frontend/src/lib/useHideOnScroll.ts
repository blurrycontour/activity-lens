import { useEffect } from 'react'

/** Ignore jitter: a scroll has to travel this far before it counts as a direction. */
const THRESHOLD = 12
/** Never hide within this much of the top — there is nothing to reveal up there. */
const TOP_GRACE = 80

/**
 * Hides the floating action button while the reader is scrolling down.
 *
 * The FAB is fixed, so it sits over whatever happens to be beneath it at every
 * scroll position — on the dashboard that is the goal history bars, on the
 * library a workout row. `.with-fab` reserves room at the *end* of the scroll,
 * which solves the last screenful and nothing before it.
 *
 * Scrolling down is reading, and reading is when the button is in the way;
 * scrolling up is looking for something, which is when it is wanted. That is
 * the behaviour every platform's guidelines describe, and it costs nothing to
 * anyone who never scrolls.
 *
 * Written to a body attribute rather than returned as state because five
 * different pages draw a `.fab` and none of them should have to know about
 * this. One listener, one CSS rule.
 */
export function useHideOnScroll(el: HTMLElement | null) {
  useEffect(() => {
    if (!el) return
    let last = el.scrollTop
    // Only ever cleared here, so a page that unmounts mid-scroll cannot leave
    // the attribute set and every FAB in the app invisible.
    const show = () => document.body.removeAttribute('data-fab-hidden')

    const onScroll = () => {
      const top = el.scrollTop
      const moved = top - last
      if (Math.abs(moved) < THRESHOLD) return
      last = top
      if (moved < 0 || top < TOP_GRACE) show()
      else document.body.setAttribute('data-fab-hidden', '')
    }

    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      show()
    }
  }, [el])
}
