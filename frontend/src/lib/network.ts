import { useEffect, useState } from 'react'

import { FROM_CACHE_HEADER } from './swCache'

// Whether the app can actually reach its backend.
//
// `navigator.onLine` only knows whether a network interface exists, so it stays
// true on a captive portal, a dead VPN, or a closed dev tunnel — all situations
// where this app is effectively offline. So the browser's signal is combined
// with what real requests are doing: api.ts reports the outcome of every call,
// and that outcome wins over navigator.onLine.

// Re-exported so callers have one obvious import for network concerns.
export { FROM_CACHE_HEADER }

type Listener = (reachable: boolean) => void

const listeners = new Set<Listener>()
// null until a request has actually told us something.
let reported: boolean | null = null

/**
 * Records whether the backend answered. Called by the API client for every
 * request: `false` when the request threw or was served from the offline cache,
 * `true` when the network genuinely answered.
 */
export function reportReachability(reachable: boolean): void {
  if (reported === reachable) return
  reported = reachable
  listeners.forEach(fn => fn(reachable))
}

function currentlyOnline(): boolean {
  // A browser that knows it is offline is always believed; it is only the
  // optimistic direction that cannot be trusted.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  return reported ?? true
}

/**
 * Tracks whether the backend is reachable, combining the browser's own signal
 * with the observed outcome of API requests.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(currentlyOnline)

  useEffect(() => {
    const update = () => setOnline(currentlyOnline())

    // The browser regaining an interface is not proof the backend is reachable,
    // but it does invalidate the previous verdict — let the next request decide.
    const onBrowserOnline = () => {
      reported = null
      update()
    }
    const onBrowserOffline = () => update()

    const listener: Listener = () => update()
    listeners.add(listener)
    window.addEventListener('online', onBrowserOnline)
    window.addEventListener('offline', onBrowserOffline)
    update()
    return () => {
      listeners.delete(listener)
      window.removeEventListener('online', onBrowserOnline)
      window.removeEventListener('offline', onBrowserOffline)
    }
  }, [])

  return online
}
