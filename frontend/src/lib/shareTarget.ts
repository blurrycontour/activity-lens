// Handoff between the service worker's share-target handler and the app.
//
// A service worker cannot pass a File object to a page, so the worker stashes
// the shared file in the Cache API under a fixed key and redirects to
// `/workouts?share=1`. The app then calls takeSharedFile() to claim it.
//
// Imported by both `src/sw.ts` and the app, so it must stay free of anything
// that only exists in a window (no DOM, no localStorage) — the Cache API is
// available in both contexts.

export const SHARE_CACHE = 'al-share-target'
export const SHARE_KEY = '/__shared-workout'
export const SHARE_FILENAME_HEADER = 'x-share-filename'
export const SHARE_QUERY_PARAM = 'share'

/**
 * Claims the file most recently shared into the app, or null when there is
 * none. The entry is removed as it is read, so a reload does not re-import the
 * same file and a failed import does not leave it stuck in the cache.
 */
export async function takeSharedFile(): Promise<File | null> {
  if (!('caches' in globalThis)) return null
  try {
    const cache = await caches.open(SHARE_CACHE)
    const res = await cache.match(SHARE_KEY)
    if (!res) return null
    await cache.delete(SHARE_KEY)
    const blob = await res.blob()
    if (blob.size === 0) return null
    const raw = res.headers.get(SHARE_FILENAME_HEADER)
    let name = 'shared-workout.gpx'
    if (raw) {
      try {
        name = decodeURIComponent(raw)
      } catch {
        name = raw
      }
    }
    return new File([blob], name, { type: blob.type || 'application/octet-stream' })
  } catch {
    return null
  }
}

/**
 * Reads the `?share=` marker the worker redirects with and removes it from the
 * URL, so a refresh does not look like a fresh share. Returns the marker value
 * ('1' on success, 'empty'/'error' otherwise) or null when absent.
 */
export function consumeShareParam(): string | null {
  const url = new URL(window.location.href)
  const value = url.searchParams.get(SHARE_QUERY_PARAM)
  if (value === null) return null
  url.searchParams.delete(SHARE_QUERY_PARAM)
  window.history.replaceState(null, '', url.pathname + url.search + url.hash)
  return value
}
