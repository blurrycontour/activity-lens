import * as maplibregl from 'maplibre-gl'
import { isNative } from './serverConfig'
import { SCHEME, cachedURL, directURL } from './tileScheme'

// Re-exported so callers that want a cached URL can keep asking this module for
// it, while ones that only want the URL can import tileScheme and leave MapLibre
// out of their graph.
export { cachedURL }

/**
 * A persistent, bounded cache for map tiles in the Android app.
 *
 * The web app already has one: the service worker serves tile hosts CacheFirst.
 * The app has no service worker at all — deliberately, because one that outlives
 * an APK update can shadow the installed build — so nothing there caches tiles
 * beyond whatever the WebView's HTTP cache decides to keep, which is unbounded,
 * unobservable and evicted on its own schedule. On a weak connection that means
 * re-downloading the same tiles for the same route every time it is opened.
 *
 * MapLibre used to cache tiles in the Cache API itself; version 6 does not, so
 * this reinstates it through the one hook it does offer. Requests are addressed
 * with a private scheme, which routes them here instead of to the network:
 *
 *     alcache://tiles.openfreemap.org/styles/liberty
 *
 * Style JSON is rewritten on the way through so the tiles, glyphs and sprites it
 * names come back through the same door. Without that only the style document
 * itself would be cached, which is the least interesting byte of the lot.
 */

const CACHE_NAME = 'map-tiles-v1'

/**
 * Roughly how many responses to keep.
 *
 * Vector tiles are tens of kilobytes, so a few hundred is a handful of
 * megabytes and covers several routes at the zoom levels anyone actually looks
 * at. The bound matters more than its exact value: without one this grows until
 * the device pushes back, and a training log is not what anyone wants filling
 * their storage.
 */
const MAX_ENTRIES = 800

/** How often to check the size, in stores. Trimming on every put is wasteful. */
const TRIM_EVERY = 50

/**
 * Points the style's own references back through the cache.
 *
 * A style names its tile endpoints, its glyph range template and its sprite
 * sheet as absolute URLs. They are what the map actually spends its bandwidth
 * on, and each is fetched through the same resource loader, so rewriting them
 * here is all it takes for them to arrive back at this handler.
 */
function rewriteStyle(style: unknown): unknown {
  if (!style || typeof style !== 'object') return style
  const s = style as Record<string, unknown>
  if (typeof s.glyphs === 'string') s.glyphs = cachedURL(s.glyphs)
  if (typeof s.sprite === 'string') s.sprite = cachedURL(s.sprite)
  const sources = s.sources as Record<string, Record<string, unknown>> | undefined
  for (const source of Object.values(sources ?? {})) {
    if (typeof source.url === 'string') source.url = cachedURL(source.url)
    if (Array.isArray(source.tiles)) {
      source.tiles = (source.tiles as string[]).map(cachedURL)
    }
  }
  return s
}

let stores = 0

async function trim(cache: Cache) {
  const keys = await cache.keys()
  if (keys.length <= MAX_ENTRIES) return
  // Cache API keys come back in insertion order and it offers no eviction of
  // its own, so dropping from the front is FIFO. Not LRU, but a tile that has
  // not been re-requested since it was stored is exactly the one to lose, and
  // the difference is not worth tracking access times for.
  await Promise.all(keys.slice(0, keys.length - MAX_ENTRIES).map(k => cache.delete(k)))
}

let installed = false

/** Registers the protocol handler. Safe to call more than once. */
export function installTileCache() {
  if (installed || !isNative()) return
  installed = true

  maplibregl.addProtocol(SCHEME, async (params, abortController) => {
    const url = directURL(params.url)
    const json = params.type === 'json'

    // `caches` needs a secure context. The app's WebView is one
    // (https://localhost), but failing softly here costs a cache rather than a
    // map, which is the right way round.
    const cache = 'caches' in self ? await caches.open(CACHE_NAME).catch(() => null) : null

    const hit = await cache?.match(url).catch(() => undefined)
    if (hit) {
      return { data: json ? rewriteStyle(await hit.json()) : await hit.arrayBuffer() }
    }

    const response = await fetch(url, { signal: abortController.signal })
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText} — ${url}`)
    }
    // Stored before the body is read here, and read from the clone, because a
    // Response body can only be consumed once.
    if (cache) {
      await cache.put(url, response.clone()).catch(() => {})
      if (++stores % TRIM_EVERY === 0) await trim(cache).catch(() => {})
    }
    return { data: json ? rewriteStyle(await response.json()) : await response.arrayBuffer() }
  })
}
