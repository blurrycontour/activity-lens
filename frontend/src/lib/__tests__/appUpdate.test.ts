import { describe, expect, it } from 'vitest'
import { canInstallOver, updateAvailable } from '../native/appUpdate'

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

/**
 * Whether an offered APK would replace this app or install beside it.
 *
 * This is the check that stops a locally built `.dev` install from being
 * offered the published APK forever: Android matches applications by id, so
 * installing that one adds a second app and leaves this one untouched — the
 * prompt reappears on every launch and nothing the user does ends it.
 */
describe('canInstallOver', () => {
  const PUBLISHED = 'io.blurrycontour.activitylens'
  const LOCAL = 'io.blurrycontour.activitylens.dev'

  it('accepts an APK that installs as the running app', () => {
    expect(canInstallOver(PUBLISHED, PUBLISHED)).toBe(true)
  })

  it('refuses the published APK for a locally built install', () => {
    expect(canInstallOver(LOCAL, PUBLISHED)).toBe(false)
  })

  it('refuses a local APK for the published install, the other way round', () => {
    expect(canInstallOver(PUBLISHED, LOCAL)).toBe(false)
  })

  // Servers built before apk.json carried the id send nothing. Refusing there
  // would take the updater away from every app talking to an older instance,
  // which is a worse failure than the one this prevents.
  it('assumes it fits when the server does not say', () => {
    expect(canInstallOver(PUBLISHED, '')).toBe(true)
    expect(canInstallOver('', PUBLISHED)).toBe(true)
  })
})
