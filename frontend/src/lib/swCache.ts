// Names of the caches the service worker maintains, plus the app-side helpers
// that need to reach into them. Shared by `src/sw.ts` and the app so the two
// cannot drift apart.

/** Cached API GET responses, used to serve the app offline. */
export const API_CACHE = 'al-api'

/** Cached map tiles for the workout route map. */
export const TILE_CACHE = 'al-map-tiles'

/**
 * Header the worker stamps on responses it served from cache because the
 * network did not answer. Lives here rather than next to the network hook so
 * the worker can import it without pulling React into its bundle.
 */
export const FROM_CACHE_HEADER = 'x-al-from-cache'

/**
 * Drops every cached API response. Called on logout so one user's data is not
 * left on the device for the next person to sign in.
 */
export async function clearApiCache(): Promise<void> {
  if (!('caches' in globalThis)) return
  try {
    await caches.delete(API_CACHE)
  } catch {
    // A failure here is not worth interrupting logout for.
  }
}
