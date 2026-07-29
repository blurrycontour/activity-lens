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

/**
 * Statuses that mean an intermediary answered *on the backend's behalf* because
 * it could not reach it. Behind a reverse proxy this is what "the server is
 * down" actually looks like: the proxy is alive and replies 502, so the request
 * neither throws nor comes from cache — it just never reached the app.
 *
 * Treating these as successful responses is what made the offline banner miss
 * an outage entirely once the app moved behind Caddy. 521-524 are Cloudflare's
 * equivalents, included so this keeps working behind one.
 */
const GATEWAY_ERROR_STATUSES = new Set([502, 503, 504, 521, 522, 523, 524])

/** Whether a status means an intermediary could not reach the backend. */
export function isGatewayError(status: number): boolean {
  return GATEWAY_ERROR_STATUSES.has(status)
}

/**
 * Whether a response is evidence that the backend itself is reachable.
 *
 * It is not enough for the fetch to resolve: the service worker answers from
 * its cache when the network is down (marked with FROM_CACHE_HEADER), and a
 * proxy answers with a gateway error when the origin is down. Only a response
 * that came off the network *from the app* counts.
 */
export function respondedFromBackend(res: Response): boolean {
  return res.headers.get(FROM_CACHE_HEADER) !== '1' && !isGatewayError(res.status)
}

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

// --- Active probing ---------------------------------------------------------
//
// Request outcomes alone only tell us something when a request happens, so
// connectivity lost while the user sits on a page would go unnoticed until they
// navigated. That is the common case behind a reverse proxy or a dev tunnel,
// where the machine keeps its network interface (and `navigator.onLine` stays
// true) while the backend becomes unreachable. So poll a cheap endpoint.

/** Public, tiny, and already fetched at boot, so it is warm in the SW cache. */
const PROBE_PATH = '/api/auth/config'
const ONLINE_INTERVAL_MS = 15_000
/** Poll harder while offline so reconnecting is noticed promptly. */
const OFFLINE_INTERVAL_MS = 6_000
/** A probe that has not answered by now counts as unreachable. */
const PROBE_TIMEOUT_MS = 7_000

let timer: number | null = null
let monitoring = false

/**
 * Checks reachability right now, records the verdict, and returns it.
 *
 * A response only counts as proof of connectivity if it actually came off the
 * network: the service worker answers from its cache when the network is down,
 * which looks identical to a successful request from here without the marker.
 */
export async function probeReachability(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    reportReachability(false)
    return false
  }
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(PROBE_PATH, {
      credentials: 'same-origin',
      // Bypass the HTTP cache; the service worker still intercepts, and its
      // from-cache marker is what actually distinguishes the two cases.
      cache: 'no-store',
      signal: controller.signal,
    })
    const live = respondedFromBackend(res)
    reportReachability(live)
    return live
  } catch {
    // Transport failure, or the abort above.
    reportReachability(false)
    return false
  } finally {
    window.clearTimeout(timeout)
  }
}

function schedule(): void {
  if (timer !== null) window.clearTimeout(timer)
  timer = window.setTimeout(tick, currentlyOnline() ? ONLINE_INTERVAL_MS : OFFLINE_INTERVAL_MS)
}

async function tick(): Promise<void> {
  // Never poll a backgrounded tab; the check on resume covers that case.
  if (document.visibilityState === 'visible') await probeReachability()
  schedule()
}

/**
 * Re-arms the timer whenever the verdict changes, so going offline switches to
 * the faster cadence immediately instead of after the interval already in
 * flight — which is what made reconnection feel slow to notice.
 */
listeners.add(() => {
  if (monitoring) schedule()
})

/**
 * Starts watching reachability for the lifetime of the app. Safe to call more
 * than once; only the first call takes effect.
 */
export function startNetworkMonitor(): void {
  if (monitoring) return
  monitoring = true

  document.addEventListener('visibilitychange', () => {
    // Coming back to the app is the moment the answer is most likely stale.
    if (document.visibilityState === 'visible') void tick()
  })
  // A regained interface says nothing about the backend, so confirm it.
  window.addEventListener('online', () => void probeReachability())
  schedule()
}

/**
 * Tracks whether the backend is reachable, combining the browser's own signal
 * with the observed outcome of API requests.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(currentlyOnline)

  useEffect(() => {
    const update = () => setOnline(currentlyOnline())

    // A regained interface is not evidence the backend came back, so the last
    // verdict is kept until a probe replaces it. Clearing it here instead would
    // make currentlyOnline() fall back to its optimistic default and hide the
    // offline bar while the server is still down — startNetworkMonitor already
    // probes on this event, and that result is what should decide.
    const onBrowserOnline = () => { void probeReachability() }
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
