import { describe, expect, it } from 'vitest'
import { normalizeServerURL } from '../serverConfig'

// The one place in the native app where a user types free text that everything
// else depends on. Every request in the app is built by concatenating this
// result with a path, so a stray trailing slash or a pasted /api is not a
// cosmetic problem — it is every request 404ing with no obvious cause.
describe('normalizeServerURL', () => {
  const cases: [name: string, input: string, want: string][] = [
    ['assumes https when no scheme is given', 'activity.example.com', 'https://activity.example.com'],
    ['keeps an explicit scheme', 'http://192.168.1.10:9090', 'http://192.168.1.10:9090'],
    ['keeps a non-default port', 'activity.example.com:9090', 'https://activity.example.com:9090'],
    ['drops a trailing slash', 'https://activity.example.com/', 'https://activity.example.com'],
    ['drops several trailing slashes', 'https://activity.example.com///', 'https://activity.example.com'],
    // Pasted from the browser after visiting the API, which is a very easy
    // mistake to make and would otherwise send everything to /api/api/...
    ['drops a trailing /api', 'https://activity.example.com/api', 'https://activity.example.com'],
    ['drops /api with a trailing slash', 'https://activity.example.com/api/', 'https://activity.example.com'],
    ['keeps a sub-path deployment', 'https://example.com/fitness', 'https://example.com/fitness'],
    ['drops /api under a sub-path', 'https://example.com/fitness/api', 'https://example.com/fitness'],
    ['trims surrounding whitespace', '  activity.example.com  ', 'https://activity.example.com'],
    ['is case-insensitive about the scheme', 'HTTPS://activity.example.com', 'https://activity.example.com'],
    ['rejects empty input', '', ''],
    ['rejects whitespace only', '   ', ''],
    ['rejects something that cannot be a URL', 'http://', ''],
  ]

  for (const [name, input, want] of cases) {
    it(name, () => {
      expect(normalizeServerURL(input)).toBe(want)
    })
  }

  // Concatenation is the contract api.ts relies on, so assert it directly
  // rather than trusting that the strings above look right.
  it('produces a base that concatenates cleanly with an API path', () => {
    for (const input of ['activity.example.com', 'https://activity.example.com/', 'https://activity.example.com/api']) {
      expect(normalizeServerURL(input) + '/api/auth/config').toBe('https://activity.example.com/api/auth/config')
    }
  })
})
