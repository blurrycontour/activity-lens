// Offline data for the Android app.
//
// On web the service worker does this: API GETs go network-first into the
// `al-api` cache, and when the network does not answer the cached copy is
// returned stamped with FROM_CACHE_HEADER, which is what raises the offline
// banner. The app registers no service worker — deliberately, see main.tsx — so
// without this it shows empty screens the moment the server is unreachable,
// while the PWA on the same phone still works.
//
// The Cache API itself is available in a secure context with or without a
// worker, so the same store and the same policy are reachable from here. This is
// a faithful copy of the worker's behaviour rather than a second design: same
// cache name, same network-first order, same header, same gateway-error
// handling, and the same purge on logout.

import { isGatewayError } from './network'
import { API_CACHE, FROM_CACHE_HEADER } from './swCache'

async function openCache(): Promise<Cache | null> {
  if (!('caches' in globalThis)) return null
  try {
    return await caches.open(API_CACHE)
  } catch {
    // Storage can be unavailable or full. Requests still work; they just stop
    // being answered offline.
    return null
  }
}

/** Marks a cached response, so the offline banner can tell stale from live. */
async function stamp(res: Response): Promise<Response> {
  const headers = new Headers(res.headers)
  headers.set(FROM_CACHE_HEADER, '1')
  // Headers on a cached Response are immutable, hence the rebuild.
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers })
}

/**
 * Fetches a URL, keeping a copy for when the network is gone.
 *
 * Network first: the cache is a fallback, never a shortcut, so the app is never
 * showing yesterday's data while online. A gateway error is treated as a network
 * failure rather than a response — behind a reverse proxy that is exactly what a
 * dead backend looks like, and taking it at face value would mean showing an
 * error page while a perfectly good cached copy sat unused.
 */
export async function fetchWithCache(url: string, init: RequestInit): Promise<Response> {
  const cache = await openCache()
  try {
    const res = await fetch(url, init)
    if (isGatewayError(res.status)) {
      throw new Error(`gateway error ${res.status}`)
    }
    // Only successful bodies are worth keeping. Caching a 401 would hand the
    // user a permanent "signed out" the next time they opened the app offline.
    if (res.ok && cache) {
      void cache.put(url, res.clone()).catch(() => {})
    }
    return res
  } catch (err) {
    const cached = cache ? await cache.match(url) : undefined
    if (!cached) throw err
    return stamp(cached)
  }
}
