import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * Selecting rows in a list, with the back gesture as the way out.
 *
 * Three lists do this — workouts, plans, session history — and each had grown
 * its own copy, which is why holding a row meant slightly different things in
 * each. The behaviour worth keeping is the one Workouts had: entering selection
 * pushes a history entry, so the phone's back gesture, the hardware button and
 * the browser's back all mean "never mind" rather than "leave the page". That
 * is the same trick a dialog uses, and it is the difference between a mode you
 * can escape and one you have to hunt for an X to leave.
 *
 * `null` rather than an empty set for "not selecting": selecting nothing is a
 * real state, reachable by deselecting the last row, and it is not the same as
 * not being in the mode at all.
 */
export function useSelection<T extends string>() {
  const [selected, setSelected] = useState<Set<T> | null>(null)
  const entry = useRef(false)

  const start = useCallback((id?: T) => {
    setSelected(prev => {
      const next = new Set(prev ?? [])
      if (id) next.add(id)
      return next
    })
    if (entry.current) return
    entry.current = true
    window.history.pushState({ selecting: true }, '', window.location.href)
  }, [])

  /**
   * Leaves selection.
   *
   * @param popped true when back is what ended it, in which case the entry is
   *               already gone and going back again would leave the page.
   */
  const stop = useCallback((popped = false) => {
    setSelected(null)
    const had = entry.current
    entry.current = false
    if (had && !popped) window.history.back()
  }, [])

  useEffect(() => {
    const onPop = () => {
      // The entry being popped is ours only while a selection is up; otherwise
      // this is ordinary navigation and none of our business.
      if (entry.current) stop(true)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [stop])

  // Leaving the page entirely must not strand the pushed entry.
  useEffect(() => () => { entry.current = false }, [])

  const toggle = useCallback((id: T) => {
    setSelected(prev => {
      const next = new Set(prev ?? [])
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const ids = useMemo(() => [...(selected ?? [])], [selected])

  return {
    selected,
    selecting: selected !== null,
    ids,
    count: ids.length,
    start,
    stop,
    toggle,
    setSelected,
  }
}
