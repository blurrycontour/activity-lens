import { describe, expect, it, vi } from 'vitest'

// isNative decides whether this cache is used at all, so it is what the two
// halves of this suite differ by.
vi.mock('./serverConfig', () => ({ isNative: () => native }))
let native = true

const { cachedURL } = await import('./tileCache')

describe('cachedURL on native', () => {
  it('routes https URLs through the private scheme', () => {
    expect(cachedURL('https://tiles.openfreemap.org/styles/liberty'))
      .toBe('alcache://tiles.openfreemap.org/styles/liberty')
  })

  // Placeholders are substituted by MapLibre before the request is made, so a
  // template has to survive the rewrite intact.
  it('leaves tile template placeholders alone', () => {
    expect(cachedURL('https://a.tile.opentopomap.org/{z}/{x}/{y}.png'))
      .toBe('alcache://a.tile.opentopomap.org/{z}/{x}/{y}.png')
  })

  // Anything not https — a data: sprite, a blob: — must pass through, or the
  // handler is asked for something it cannot fetch.
  it('passes through anything that is not https', () => {
    expect(cachedURL('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA')
    expect(cachedURL('http://example.com/x')).toBe('http://example.com/x')
  })
})

describe('cachedURL on web', () => {
  it('changes nothing, because the service worker caches tiles there', async () => {
    native = false
    vi.resetModules()
    const { cachedURL: webCachedURL } = await import('./tileCache')
    expect(webCachedURL('https://tiles.openfreemap.org/styles/liberty'))
      .toBe('https://tiles.openfreemap.org/styles/liberty')
    native = true
  })
})
