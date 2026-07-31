import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchWithCache } from '../nativeCache'
import { FROM_CACHE_HEADER } from '../swCache'

/**
 * The app has no service worker, so this is the only thing standing between a
 * dropped connection and a set of empty screens. The behaviour that matters is
 * all in the failure paths, which is exactly the part nobody exercises by hand.
 */

/** A Cache API stand-in — the real one needs a browser and a secure context. */
function fakeCaches() {
  const store = new Map<string, Response>()
  return {
    store,
    caches: {
      open: async () => ({
        put: async (url: string, res: Response) => { store.set(url, res) },
        match: async (url: string) => store.get(url),
      }),
    },
  }
}

const URL_ = 'https://example.test/api/workouts'

let fake: ReturnType<typeof fakeCaches>

beforeEach(() => {
  fake = fakeCaches()
  vi.stubGlobal('caches', fake.caches)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('fetchWithCache', () => {
  it('returns the network response and keeps a copy', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('["fresh"]', { status: 200 })))

    const res = await fetchWithCache(URL_, {})

    expect(await res.text()).toBe('["fresh"]')
    // Not stamped: this came off the network, and stamping it would raise the
    // offline banner while perfectly online.
    expect(res.headers.get(FROM_CACHE_HEADER)).toBeNull()
    expect(fake.store.has(URL_)).toBe(true)
  })

  it('serves the cached copy, marked, when the network throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('["saved"]', { status: 200 })))
    await fetchWithCache(URL_, {})

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    const res = await fetchWithCache(URL_, {})

    expect(await res.text()).toBe('["saved"]')
    // The stamp is what tells reportReachability this is not evidence of a live
    // backend, and what raises the offline banner.
    expect(res.headers.get(FROM_CACHE_HEADER)).toBe('1')
  })

  it('treats a gateway error as an outage and falls back', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('["saved"]', { status: 200 })))
    await fetchWithCache(URL_, {})

    // A reverse proxy answering 502 is a resolved fetch, not a thrown one. Taking
    // it at face value would show an error page with good data sitting in cache.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad gateway', { status: 502 })))
    const res = await fetchWithCache(URL_, {})

    expect(res.status).toBe(200)
    expect(res.headers.get(FROM_CACHE_HEADER)).toBe('1')
  })

  it('rethrows when there is nothing cached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    await expect(fetchWithCache(URL_, {})).rejects.toThrow('offline')
  })

  it('does not cache failures', async () => {
    // A cached 401 would strand the user at a signed-out screen every time they
    // opened the app without a network.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"nope"}', { status: 401 })))
    await fetchWithCache(URL_, {})

    expect(fake.store.has(URL_)).toBe(false)
  })

  it('still fetches when the Cache API is unavailable', async () => {
    vi.stubGlobal('caches', undefined)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('["fresh"]', { status: 200 })))

    const res = await fetchWithCache(URL_, {})
    expect(await res.text()).toBe('["fresh"]')
  })
})
