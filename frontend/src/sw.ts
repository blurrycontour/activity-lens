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
//
// registerType is 'prompt' (see registerSW() in main.tsx). The plugin's client
// helper reports a waiting worker through onNeedRefresh and applies it only
// when the app calls updateSW(), which posts SKIP_WAITING below.
//
// injectManifest hands us a worker we authored, so nothing calls skipWaiting()
// for us. That message handler is therefore load-bearing: without it a new
// build would sit in 'waiting' forever (every open tab pins the old worker as
// controller) and the app would keep serving whatever was precached at the last
// activation — the "have to clear site data to see a new deploy" symptom.
// ── Web Push ──
// The backend sends a JSON payload; anything unparseable still shows a generic
// notification, because Chrome revokes push permission from a worker that
// receives a push and shows nothing.
interface PushPayload {
  id?: string
  kind?: string
  title?: string
  body?: string
  link?: string
  icon?: string
}

/**
 * True when a window of this app is on screen right now. An OS notification
 * would be redundant then — the app shows an in-app banner instead.
 */
async function appIsVisible(): Promise<boolean> {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  return windows.some(c => c.visibilityState === 'visible')
}

self.addEventListener('push', event => {
  let data: PushPayload = {}
  try {
    data = event.data?.json() as PushPayload ?? {}
  } catch {
    data = { title: 'Activity Lens' }
  }
  event.waitUntil(handlePush(data))
})

async function handlePush(data: PushPayload) {
  // While the app is on screen, hand the payload to it and skip the OS
  // notification — being interrupted by a banner for something already visible
  // is noise.
  //
  // Chrome permits this within a budget rather than unconditionally: a push
  // that shows nothing is allowed, but sustained abuse eventually makes it show
  // a generic "site updated in the background" notice itself. Only suppressing
  // while a window is actually visible keeps us well inside that.
  if (await appIsVisible()) {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) client.postMessage({ type: 'IN_APP_NOTIFICATION', payload: data })
    return
  }
  await self.registration.showNotification(data.title || 'Activity Lens', {
    body: data.body,
    // The sender's avatar when a person caused this, the app mark otherwise.
    icon: data.icon || '/icon-192.png',
    // The status-bar badge. Android renders this from its alpha channel alone —
    // every opaque pixel becomes white — so it has to be a transparent
    // silhouette. Pointing it at the full-colour app icon, whose alpha is
    // entirely opaque, produces a solid white square.
    badge: '/badge-96.png',
    // Tapping should land on the workout (or wherever the event points).
    data: { link: data.link || '/' },
    // Collapses repeats of the same notification rather than stacking them,
    // and lets the app close this one by id once it has been read.
    tag: data.id,
  })
}

// The app asks for an OS notification to be dismissed once it has been read
// in-app, so reading on one device does not leave a stale banner on this one.
self.addEventListener('message', event => {
  const data = event.data as { type?: string; tag?: string } | undefined
  if (data?.type !== 'DISMISS_NOTIFICATION') return
  event.waitUntil((async () => {
    const shown = await self.registration.getNotifications(data.tag ? { tag: data.tag } : {})
    for (const n of shown) n.close()
  })())
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const link = (event.notification.data as { link?: string } | undefined)?.link || '/'
  const url = new URL(link, self.location.origin).href

  // Prefer focusing an open tab and navigating it: opening a second copy of an
  // installed PWA is disorienting, and the SPA can route without a reload.
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clients) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus()
        // navigate() is not implemented everywhere; fall back to a message the
        // app handles with its own history push.
        if ('navigate' in client) {
          try {
            await client.navigate(url)
            return
          } catch { /* fall through to postMessage */ }
        }
        client.postMessage({ type: 'NAVIGATE', url: link })
        return
      }
    }
    await self.clients.openWindow(url)
  })())
})

// A new worker installs and then *waits*, rather than taking over immediately.
// Activating on its own would force a reload while the user is mid-task —
// losing a half-written note or a filled-in import form — so the app prompts
// instead and only then sends SKIP_WAITING (see registerSW in main.tsx).
self.addEventListener('message', event => {
  if ((event.data as { type?: string } | undefined)?.type === 'SKIP_WAITING') {
    void self.skipWaiting()
  }
})

self.addEventListener('activate', event => {
  // Claim open pages so the newly activated worker controls them at once; the
  // reload that follows is driven by the app, not by this.
  event.waitUntil(self.clients.claim())
})
