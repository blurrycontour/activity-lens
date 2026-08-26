import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A horizontal scroller that shows where it continues.
 *
 * A row that overflows off the right edge of a phone gives no sign it did: the
 * content simply stops at the screen. The fix is a fade at whichever end still
 * has something beyond it, and the only way to know that is to measure — a
 * breakpoint cannot, because it depends on the content as much as the width,
 * and a desktop window dragged narrower overflows too.
 *
 * Returns the ref to put on the scroller, the class suffix to append, the
 * measure function to wire to `onScroll`, and — for a caller that wants to
 * draw arrows rather than rely on the fade alone — the live edges and a way to
 * move a screenful. The caller owns the element and its styling; this owns
 * only the question of which edges are live.
 *
 * A fade is a weak signal on a row of outlined controls, where the thing it
 * fades out is a border that looked like an edge anyway. Anything whose
 * contents are not obviously continuous wants the arrows too.
 *
 * The fades themselves are a CSS mask, not an overlay — see `.tab-strip` in
 * index.css. A mask works over whatever background the scroller happens to
 * have, and can never sit above the controls and swallow a tap.
 */
export function useEdgeFades<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [edges, setEdges] = useState({ start: false, end: false })

  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    // A 1px tolerance: fractional layout widths otherwise leave the "more this
    // way" fade showing permanently at the end of the scroll.
    const max = el.scrollWidth - el.clientWidth
    setEdges(cur => {
      const next = { start: el.scrollLeft > 1, end: el.scrollLeft < max - 1 }
      return cur.start === next.start && cur.end === next.end ? cur : next
    })
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    measure()
    // Resize covers rotation, a desktop window dragged narrower, and the
    // content itself changing width.
    const obs = new ResizeObserver(measure)
    obs.observe(el)
    for (const child of el.children) obs.observe(child)
    return () => obs.disconnect()
  }, [measure])

  /**
   * Move about a screenful in one direction, for a caller that draws arrows.
   *
   * Not the whole width: a page that turns over completely leaves nothing to
   * anchor against, and the item that was at the edge is the one you were
   * reading. Four fifths keeps a column of overlap.
   */
  const scrollByPage = useCallback((direction: 1 | -1) => {
    const el = ref.current
    if (!el) return
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' })
  }, [])

  const fadeClass = `${edges.start ? ' fade-start' : ''}${edges.end ? ' fade-end' : ''}`
  return { ref, fadeClass, edges, measure, scrollByPage }
}

/**
 * Bring one child of a scroller into view horizontally, without moving the page.
 *
 * `scrollIntoView` on a horizontal scroller also scrolls every ancestor, which
 * lands the reader halfway down the page for the crime of switching tabs. This
 * centres the child by hand instead.
 */
export function centreInScroller(el: HTMLElement | null, child: HTMLElement | null) {
  if (!el || !child) return
  const left = child.offsetLeft - (el.clientWidth - child.clientWidth) / 2
  el.scrollTo({ left: Math.max(0, left), behavior: 'smooth' })
}
