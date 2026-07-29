import { useEffect, useState } from 'react'

/**
 * The single phone/desktop breakpoint, matching the `max-width: 768px` media
 * query that index.css uses. Kept here so the JS and CSS definitions of
 * "mobile" cannot drift apart.
 */
export const MOBILE_QUERY = '(max-width: 768px)'

/** True while the viewport is phone-sized. Updates on resize and rotation. */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches)

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY)
    const handle = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handle)
    // Re-sync in case the viewport changed between render and effect.
    setIsMobile(mq.matches)
    return () => mq.removeEventListener('change', handle)
  }, [])

  return isMobile
}
