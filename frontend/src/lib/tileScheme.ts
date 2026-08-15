import { isNative } from './serverConfig'

/**
 * The private URL scheme the Android tile cache answers on, and the two
 * functions that translate in and out of it.
 *
 * Split out of tileCache so that naming a cached URL does not drag MapLibre in
 * with it. `installTileCache` registers a protocol handler and genuinely needs
 * the library; `cachedURL` is string manipulation, and it is the half that the
 * map style definitions call — which are in turn read by pages that never build
 * a map. Keeping them together put MapLibre in the startup graph for everyone.
 */
export const SCHEME = 'alcache'

/** Rewrites a URL to route through the cache, on the platforms that need it. */
export function cachedURL(url: string): string {
  if (!isNative() || !url.startsWith('https://')) return url
  return SCHEME + '://' + url.slice('https://'.length)
}

/** The inverse: back to the address the network understands. */
export function directURL(url: string): string {
  return 'https://' + url.slice(SCHEME.length + 3)
}
