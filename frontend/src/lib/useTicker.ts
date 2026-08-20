import { useEffect, useState } from 'react'

/**
 * Re-renders on an interval, for anything showing a clock that has to move.
 *
 * The elapsed time on a running session is derived from its start rather than
 * stored, which is right — but a derived value only changes when something
 * re-renders, so the banner sat still until an unrelated click happened to
 * refresh it. This is the render.
 *
 * Returns the current time so a caller can use it directly; most just need the
 * side effect.
 */
export default function useTicker(ms = 1000, on = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    const id = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(id)
  }, [ms, on])
  return now
}
