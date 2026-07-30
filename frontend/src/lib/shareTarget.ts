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
 * Cache key for the nth shared file. Android can share several files at once,
 * so each gets its own entry; the app reads upward from 0 until one is missing.
 * Numbering rather than a manifest entry keeps the worker's job to a single
 * put() per file with nothing to keep in step.
 */
export function shareKeyAt(index: number): string {
  return `${SHARE_KEY}/${index}`
}

/** Upper bound on one share, so a malformed cache cannot loop forever. */
export const MAX_SHARED_FILES = 200

/**
 * Claims every file from the most recent share, in the order they arrived.
 * Entries are removed as they are read, so a reload does not re-import the same
 * files and a failed import does not leave them stuck in the cache.
 *
 * Returns an empty array when there is nothing to claim.
 */
export async function takeSharedFiles(): Promise<File[]> {
  if (!('caches' in globalThis)) return []
  try {
    const cache = await caches.open(SHARE_CACHE)
    const files: File[] = []
    for (let i = 0; i < MAX_SHARED_FILES; i++) {
      const key = shareKeyAt(i)
      const res = await cache.match(key)
      if (!res) break
      await cache.delete(key)
      const blob = await res.blob()
      if (blob.size === 0) continue
      files.push(new File([blob], sharedFilename(res, i), { type: blob.type || 'application/octet-stream' }))
    }
    // Older builds wrote a single unnumbered entry. Reading it too means a
    // share that arrived before an update is not stranded in the cache.
    const legacy = await cache.match(SHARE_KEY)
    if (legacy) {
      await cache.delete(SHARE_KEY)
      const blob = await legacy.blob()
      if (blob.size > 0) {
        files.push(new File([blob], sharedFilename(legacy, 0), { type: blob.type || 'application/octet-stream' }))
      }
    }
    return files
  } catch {
    return []
  }
}

/** Recovers the original filename from the header the worker set. */
function sharedFilename(res: Response, index: number): string {
  const raw = res.headers.get(SHARE_FILENAME_HEADER)
  const fallback = index === 0 ? 'shared-workout.gpx' : `shared-workout-${index + 1}.gpx`
  if (!raw) return fallback
  try {
    return decodeURIComponent(raw) || fallback
  } catch {
    return raw
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
