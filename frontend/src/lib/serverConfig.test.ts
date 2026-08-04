import { describe, expect, it } from 'vitest'
import { isInsecureURL } from './serverConfig'

// The consequences of getting this wrong run in both directions: a false
// negative hides the one warning a user gets that their password is readable on
// the wire, and a false positive nags every localhost developer forever.
describe('isInsecureURL', () => {
  it('flags plain http to a real host', () => {
    expect(isInsecureURL('http://lens.example.com')).toBe(true)
    expect(isInsecureURL('http://192.168.1.10:8080')).toBe(true)
  })

  it('accepts https anywhere', () => {
    expect(isInsecureURL('https://lens.example.com')).toBe(false)
    expect(isInsecureURL('https://192.168.1.10:8080')).toBe(false)
  })

  // Loopback never touches a network, which is why browsers treat it as a
  // secure context too.
  it('accepts loopback over http', () => {
    expect(isInsecureURL('http://localhost:8080')).toBe(false)
    expect(isInsecureURL('http://127.0.0.1:8080')).toBe(false)
    expect(isInsecureURL('http://[::1]:8080')).toBe(false)
  })

  // A host merely containing "localhost" is not loopback, and treating it as
  // such would silently suppress the warning for an attacker-chosen name.
  it('does not accept hosts that only look like loopback', () => {
    expect(isInsecureURL('http://localhost.example.com')).toBe(true)
    expect(isInsecureURL('http://notlocalhost')).toBe(true)
  })

  it('says nothing about input it cannot parse', () => {
    expect(isInsecureURL('')).toBe(false)
    expect(isInsecureURL('not a url')).toBe(false)
  })
})
