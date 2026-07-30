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

/** True only in the Android app, where an in-place update is possible at all. */
export function canSelfUpdate(): boolean {
  return isNative()
}
