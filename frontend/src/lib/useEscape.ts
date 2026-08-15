import { useEffect, useRef } from 'react'

/**
 * Closes a dismissible surface on Escape.
 *
 * For the popovers — dropdowns, menus, tooltips — that are not `Modal`s.
 * Anything rendered through `Modal` already gets this, and back-gesture
 * handling with it, from `useDismissOnBack`; adding this on top would run the
 * dismiss twice.
 *
 * @param open  whether the surface is currently up
 * @param close called when Escape is pressed
 */
export default function useEscape(open: boolean, close: () => void) {
  // A ref, so a caller passing a fresh closure each render does not rebind the
  // listener on every render.
  const fn = useRef(close)
  fn.current = close

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') fn.current() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])
}
