import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface TabStripItem<T extends string> {
  id: T
  label: string
  icon?: React.ReactNode
  /**
   * One line saying what is behind the tab, shown under the strip when it is
   * the selected one.
   *
   * A strip of five reaches a phone with the last item past the right edge, and
   * a label like "Load" or "Compare" says nothing about whether it is worth the
   * scroll. Every chart on these pages already carries a description; the tabs
   * that hold them carried none.
   */
  blurb?: string
  /**
   * How much is behind the tab, shown as a small figure after the label.
   *
   * Zero and undefined both render nothing: a badge exists to say a tab is
   * worth opening, and "0" is a thing to read rather than an answer. That
   * makes "no badge" mean "nothing there", which only holds because every
   * caller has the count in hand before the strip draws — a tab whose count
   * is still loading must not pass one.
   */
  count?: number
}

interface TabStripProps<T extends string> {
  items: TabStripItem<T>[]
  value: T
  onChange: (id: T) => void
  /** Names the strip for assistive tech, e.g. "Analysis sections". */
  ariaLabel: string
  /**
   * Share the full width between the tabs on a phone rather than leaving the
   * strip short of the right edge. Only for strips of two or three: more than
   * that needs the scrolling this component was built around.
   */
  fill?: boolean
}

/**
 * A horizontal strip of sections.
 *
 * The strip has always scrolled when it did not fit, which was fine at four
 * tabs and stopped being fine at five: on a phone the last one sat entirely
 * past the right edge, with nothing on screen to suggest it existed. A tab
 * nobody can see is a tab nobody uses.
 *
 * Two things fix that, and both are needed:
 *
 *   - the selected tab is scrolled into view, so returning to the page shows
 *     you where you are rather than the start of a list;
 *   - the edge fades while there is more in that direction, which is the only
 *     on-screen evidence that scrolling is possible.
 *
 * The fade is driven by measurement rather than a media query, so it is right
 * for any number of tabs at any width — including a desktop window narrowed to
 * the point where the strip overflows, which no breakpoint would catch.
 */
export default function TabStrip<T extends string>({ items, value, onChange, ariaLabel, fill }: TabStripProps<T>) {
  const ref = useRef<HTMLElement>(null)
  const [edges, setEdges] = useState({ start: false, end: false })

  function measure() {
    const el = ref.current
    if (!el) return
    // A 1px tolerance: fractional layout widths otherwise leave the "more this
    // way" fade showing permanently at the end of the scroll.
    const max = el.scrollWidth - el.clientWidth
    setEdges({ start: el.scrollLeft > 1, end: el.scrollLeft < max - 1 })
  }

  // Before paint, so the strip never appears scrolled to the wrong place.
  useLayoutEffect(() => {
    const el = ref.current
    const active = el?.querySelector<HTMLElement>('.tab-strip-item.active')
    if (!el || !active) return
    // Centred by hand rather than with scrollIntoView, which on a horizontal
    // scroller also scrolls every ancestor — landing the user halfway down the
    // page for the crime of switching tabs.
    const left = active.offsetLeft - (el.clientWidth - active.clientWidth) / 2
    el.scrollTo({ left: Math.max(0, left), behavior: 'smooth' })
  }, [value])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    measure()
    // Resize covers rotation and a desktop window being dragged narrower.
    const obs = new ResizeObserver(measure)
    obs.observe(el)
    return () => obs.disconnect()
  }, [items.length])

  const blurb = items.find(t => t.id === value)?.blurb

  return (
    <>
    <nav
      ref={ref}
      className={`tab-strip${fill ? ' fill' : ''}${edges.start ? ' fade-start' : ''}${edges.end ? ' fade-end' : ''}`}
      aria-label={ariaLabel}
      onScroll={measure}
    >
      {items.map(t => (
        <button
          key={t.id}
          className={`tab-strip-item${value === t.id ? ' active' : ''}`}
          onClick={() => onChange(t.id)}
          aria-current={value === t.id ? 'page' : undefined}
        >
          {t.icon}
          {t.label}
          {!!t.count && <span className="tab-strip-count">{t.count}</span>}
        </button>
      ))}
    </nav>
    {/* Outside the nav, so the strip's own scrolling and edge fades are not
        applied to a paragraph that neither scrolls nor needs them. */}
    {blurb && <p className="tab-strip-blurb">{blurb}</p>}
    </>
  )
}
