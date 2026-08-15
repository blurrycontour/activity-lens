import { api, type BuildInfo } from './api'
import { isNative } from './serverConfig'
import { installedApp } from './native/appUpdate'

/**
 * What the About dialog shows, fetched once per session and kept.
 *
 * It used to be fetched when the dialog opened, which meant the dialog opened
 * empty and grew as two requests landed — placeholders standing in for rows
 * that, depending on what the server reported, did not all turn up. None of it
 * changes while the app is running, so the honest fix is to have the answer
 * before it is asked for rather than to animate the wait.
 *
 * Warmed in the background after sign-in; a dialog opened before that lands
 * still resolves through the same promise rather than starting a second
 * request.
 */
export interface AboutInfo {
  build: BuildInfo | null
  /** The installed APK's version. Android only, null everywhere else. */
  appVersion: string | null
}

let pending: Promise<AboutInfo> | null = null
let resolved: AboutInfo | null = null

/** The answer if it has already arrived, for a first render with no wait. */
export function peekAboutInfo(): AboutInfo | null {
  return resolved
}

/**
 * The answer, fetching it once if needed.
 *
 * Neither half is allowed to fail the whole: a server too old to serve /build
 * and a platform with no installed APK are both ordinary, and both simply mean
 * fewer rows.
 */
export function loadAboutInfo(): Promise<AboutInfo> {
  pending ??= Promise.all([
    api.buildInfo().catch(() => null),
    isNative() ? installedApp().then(i => i.version).catch(() => null) : Promise.resolve(null),
  ]).then(([build, appVersion]) => {
    resolved = { build, appVersion }
    return resolved
  })
  return pending
}
