/**
 * Loading a code-split chunk, and surviving the case where it is not there.
 *
 * The app is split into chunks whose names carry a content hash, and the HTML
 * that names them is the only thing that knows which hash is current. A client
 * can end up holding an older copy of that HTML than the server has files for —
 * a tab left open across a deploy, a proxy that cached the shell, a service
 * worker the user has not let update yet — and the moment such a page opens the
 * map, it asks for a chunk that no longer exists.
 *
 * The server answers 404 for that (see internal/web), which surfaces as a
 * rejected dynamic import and, without this, as a page stuck on its loading
 * spinner forever. The fix is the one the user would apply themselves: fetch
 * the page again, which fetches the current HTML, which names chunks that exist.
 *
 * Once, though. A chunk that fails for any other reason — an actual bug, a
 * network that is down — must not put the app in a reload loop, so the attempt
 * is recorded and a second failure is allowed to surface as an error.
 */

/** Where the "we already tried reloading" mark lives, for this tab only. */
const RETRY_KEY = 'al_chunk_reload'

/** How long a recorded attempt counts for. */
const RETRY_WINDOW_MS = 30_000

export interface RetryHost {
  now: () => number
  read: () => string | null
  write: (value: string) => void
  clear: () => void
  reload: () => void
}

/**
 * Decides what to do about a failed chunk load, and does it.
 *
 * Returns true when a reload was started — the caller should stop, since the
 * page is on its way out. Separated from the loader below so the decision can
 * be tested without a browser: every branch here is either an infinite reload
 * loop or a permanently broken page, and neither shows up in a type check.
 */
export function handleChunkFailure(host: RetryHost): boolean {
  const last = Number(host.read() ?? 0)
  if (last > 0 && host.now() - last < RETRY_WINDOW_MS) {
    // We already reloaded for this, moments ago, and it failed again. The
    // problem is not a stale build.
    host.clear()
    return false
  }
  host.write(String(host.now()))
  host.reload()
  return true
}

/** The browser this actually runs in. Storage can throw in a private window. */
function browserHost(): RetryHost {
  return {
    now: () => Date.now(),
    read: () => { try { return sessionStorage.getItem(RETRY_KEY) } catch { return null } },
    write: value => { try { sessionStorage.setItem(RETRY_KEY, value) } catch { /* ignore */ } },
    clear: () => { try { sessionStorage.removeItem(RETRY_KEY) } catch { /* ignore */ } },
    reload: () => window.location.reload(),
  }
}

/**
 * Wraps a dynamic import for React.lazy so a stale build heals itself.
 *
 * Use it for every lazy import: the failure it recovers from is a property of
 * code splitting, not of any particular page.
 */
export function lazyChunk<T>(load: () => Promise<T>): () => Promise<T> {
  return async () => {
    try {
      const mod = await load()
      // A load that worked means whatever we reloaded for is behind us, and
      // the next failure deserves its own attempt rather than inheriting this
      // one's mark.
      browserHost().clear()
      return mod
    } catch (err) {
      if (handleChunkFailure(browserHost())) {
        // Hang rather than reject: the page is being replaced, and an error
        // boundary flashing up first is noise about something already fixed.
        return await new Promise<T>(() => {})
      }
      throw err
    }
  }
}
