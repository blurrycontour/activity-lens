import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { apiURL } from '../api'
import { isNative } from '../serverConfig'

/** Implemented by mobile/android/.../AppUpdatePlugin.java. */
interface AppUpdatePlugin {
  getInfo(): Promise<{ version: string; versionCode: number; packageName: string; canInstall: boolean }>
  openInstallSettings(): Promise<void>
  downloadAndInstall(options: { url: string }): Promise<void>
  addListener(event: 'updateProgress', fn: (e: UpdateProgress) => void): Promise<PluginListenerHandle>
}

export interface UpdateProgress {
  /** 'download' while bytes are moving; 'install' once the system has them. */
  phase: 'download' | 'install'
  bytes: number
  /** -1 when the server did not send a Content-Length. */
  total: number
}

const AppUpdate = registerPlugin<AppUpdatePlugin>('AppUpdate')

/** What the running app is, and whether it is allowed to install an update. */
export function installedApp() {
  return AppUpdate.getInfo()
}

/** Opens the system screen where "install unknown apps" is granted. */
export function openInstallSettings() {
  return AppUpdate.openInstallSettings()
}

export function onUpdateProgress(fn: (e: UpdateProgress) => void) {
  return AppUpdate.addListener('updateProgress', fn)
}

/**
 * Downloads the APK this server offers and hands it to the system installer.
 * Resolves only once the install is settled, so a progress UI can stay up for
 * the whole operation.
 */
export function downloadAndInstall() {
  return AppUpdate.downloadAndInstall({ url: apiURL('/api/app/android/download') })
}

/** Rejected by downloadAndInstall when the user has not allowed installs yet. */
export const INSTALL_NOT_PERMITTED = 'install-not-permitted'

/**
 * Whether the app the server offers differs from the one running.
 *
 * A string comparison, not a semver ordering, and deliberately so: the server
 * is the authority on which build belongs with it, so "different" is the whole
 * question. An instance that is rolled back to an older release should move its
 * clients back too, and a `>` comparison would silently refuse to.
 */
export function updateAvailable(installed: string, offered: string): boolean {
  const norm = (v: string) => v.trim().replace(/^v/, '')
  return offered !== '' && installed !== '' && norm(installed) !== norm(offered)
}

/**
 * Whether the offered APK would *replace* the running app rather than install
 * beside it.
 *
 * Android matches applications by id, and refuses to replace one whose id
 * differs — it installs a second copy instead. So a server bundling the
 * published `io.blurrycontour.activitylens` has nothing to offer a locally
 * built `io.blurrycontour.activitylens.dev`: downloading it would add another
 * app to the launcher and leave this one exactly as it was, which is an update
 * prompt that can never be satisfied and therefore never stops.
 *
 * An empty `offered` means the server's metadata predates the field. Treated as
 * "assume it fits", which is how this behaved before it existed — the version
 * comparison alone is then the whole test, as it was.
 */
export function canInstallOver(installed: string, offered: string): boolean {
  if (offered === '' || installed === '') return true
  return installed === offered
}

/** True only in the Android app, where an in-place update is possible at all. */
export function canSelfUpdate(): boolean {
  return isNative()
}

/**
 * Asks the update prompt to check now and show itself even if this version was
 * dismissed earlier.
 *
 * A window event rather than shared state: Settings and the prompt live in
 * different parts of the tree, and this is the same pattern the notification
 * bell already uses to hear about a push.
 */
export const UPDATE_CHECK_EVENT = 'al-check-update'

export function requestUpdateCheck(): void {
  window.dispatchEvent(new Event(UPDATE_CHECK_EVENT))
}
