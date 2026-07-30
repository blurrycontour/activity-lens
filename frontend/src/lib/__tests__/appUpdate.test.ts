import { describe, expect, it } from 'vitest'
import { updateAvailable } from '../native/appUpdate'

// This decides whether a user is interrupted by an update dialog, so both
// directions matter: nagging about an update that is already installed is as
// bad as never offering one.
describe('updateAvailable', () => {
  it('offers an update when the server publishes a different version', () => {
    expect(updateAvailable('1.4.1', '1.4.2')).toBe(true)
  })

  it('stays quiet when the installed app already matches', () => {
    expect(updateAvailable('1.4.2', '1.4.2')).toBe(false)
  })

  // The server is the authority on which build belongs with it, so a rolled-back
  // instance must be able to move its clients back too. A "newer than" test
  // would silently refuse, leaving clients ahead of the server forever.
  it('offers a downgrade when the server has been rolled back', () => {
    expect(updateAvailable('1.5.0', '1.4.2')).toBe(true)
  })

  it('ignores a v prefix on either side', () => {
    expect(updateAvailable('v1.4.2', '1.4.2')).toBe(false)
    expect(updateAvailable('1.4.2', 'v1.4.2')).toBe(false)
  })

  it('ignores surrounding whitespace', () => {
    expect(updateAvailable(' 1.4.2 ', '1.4.2')).toBe(false)
  })

  // A missing version on either side means we do not actually know, and
  // guessing would prompt an install of something unidentified.
  it('never offers an update when a version is missing', () => {
    expect(updateAvailable('', '1.4.2')).toBe(false)
    expect(updateAvailable('1.4.2', '')).toBe(false)
  })
})
