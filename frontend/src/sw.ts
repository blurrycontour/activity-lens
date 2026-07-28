/// <reference lib="webworker" />

// Service worker for Activity Lens.
//
// Two jobs:
//  1. Cache the app shell (and map tiles) so the app opens without a network.
//  2. Receive workout files shared into the app from the Android share sheet.
//
// Built with vite-plugin-pwa's `injectManifest` strategy: the precache list is
// substituted into `self.__WB_MANIFEST` at build time, everything else here is
// hand-written because the share target needs a POST handler that a generated
// worker cannot express.

import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst, NetworkFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

import { SHARE_CACHE, SHARE_FILENAME_HEADER, SHARE_KEY, SHARE_QUERY_PARAM } from './lib/shareTarget'
import { API_CACHE, FROM_CACHE_HEADER, TILE_CACHE } from './lib/swCache'

declare const self: ServiceWorkerGlobalScope

// Where the user lands after sharing a file in. Kept in sync with nav.ts.
const SHARE_LANDING = '/workouts'

// Host suffixes of the map tile providers used by the workout map. Matching on
// suffix covers the numbered subdomains (a/b/c.tile.openstreetmap.org).
const TILE_HOSTS = ['tile.openstreetmap.org', 'tile.opentopomap.org', 'arcgisonline.com']

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// --- Share target -----------------------------------------------------------
//
// Android POSTs the shared file here as multipart/form-data. The worker cannot
// hand a File straight to the page, so it stashes the file in the Cache API and
// redirects to the app, which picks it up and opens the import modal.
//
// Registered before the navigation fallback below. Workbox matches routes per
// HTTP method, so this POST route and the GET-only navigation route can never
// collide, but keeping the order explicit avoids surprises if that changes.
registerRoute(({ url }) => url.pathname === '/share-target', handleShare, 'POST')

async function handleShare({ request }: { request: Request }): Promise<Response> {
  const landing = (status: string) => `${SHARE_LANDING}?${SHARE_QUERY_PARAM}=${status}`
  try {
    const form = await request.formData()
    // Android may send several files even though the manifest asks for one;
    // the import flow handles a single workout, so take the first.
    const file = form.getAll('file').find((v): v is File => v instanceof File && v.size > 0)
    if (!file) {
      return Response.redirect(landing('empty'), 303)
    }
    const cache = await caches.open(SHARE_CACHE)
    await cache.put(
      SHARE_KEY,
      new Response(file, {
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          // Header values must be latin-1, and filenames can be anything.
          [SHARE_FILENAME_HEADER]: encodeURIComponent(file.name || 'shared-workout.gpx'),
        },
      }),
    )
    return Response.redirect(landing('1'), 303)
  } catch {
    return Response.redirect(landing('error'), 303)
  }
}

// --- Runtime caching --------------------------------------------------------

// API reads: always prefer the network so the user sees live data, but fall
// back to the last successful response when offline. The short timeout keeps a
// flaky mobile connection from hanging the UI. Writes are never cached.
registerRoute(
  ({ url, request }) => url.pathname.startsWith('/api/') && request.method === 'GET',
  new NetworkFirst({
    cacheName: API_CACHE,
    networkTimeoutSeconds: 8,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 }),
      {
        // Falling back to the cache means the network did not answer. Mark
        // those responses so the app can tell "loaded" from "actually online"
        // and show the offline banner. Headers on a cached Response are
        // immutable, hence the rebuild.
        cachedResponseWillBeUsed: async ({ cachedResponse }) => {
          if (!cachedResponse) return cachedResponse
          const headers = new Headers(cachedResponse.headers)
          headers.set(FROM_CACHE_HEADER, '1')
          return new Response(await cachedResponse.blob(), {
            status: cachedResponse.status,
            statusText: cachedResponse.statusText,
            headers,
          })
        },
      },
    ],
  }),
)

// Map tiles are immutable, so serve them from cache and only fetch the ones we
// have not seen. Capped so a few long rides cannot fill the device's storage.
registerRoute(
  ({ url }) => TILE_HOSTS.some(host => url.hostname === host || url.hostname.endsWith('.' + host)),
  new CacheFirst({
    cacheName: TILE_CACHE,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 30, purgeOnQuotaError: true }),
    ],
  }),
)

// SPA fallback: any navigation that is not an API call or the share target is
// served the precached shell, so deep links work offline the same way the Go
// server handles them online.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//, /^\/share-target$/],
  }),
)

// --- Lifecycle --------------------------------------------------------------

// registerType is 'autoUpdate', so take over as soon as a new worker is ready
// rather than waiting for every tab to close.
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting()
})
self.addEventListener('activate', () => self.clients.claim())
