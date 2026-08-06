import { registerPlugin } from '@capacitor/core'
import { isNative } from '../serverConfig'

/** Implemented by mobile/android/.../FolderSyncPlugin.java. */
interface FolderSyncPlugin {
  getStatus(): Promise<FolderSyncStatus>
  pickFolder(): Promise<{ folder?: string | null }>
  setEnabled(options: { enabled: boolean }): Promise<void>
  scanNow(options: { force: boolean }): Promise<ScanResult>
  setInterval(options: { minutes: number }): Promise<void>
  requestBatteryExemption(): Promise<{ batteryUnrestricted: boolean }>
  removeFolder(options: { uri: string }): Promise<void>
}

export interface WatchedFolder {
  /** The tree URI, which identifies it — the label is not unique. */
  uri: string
  /** Display name, as the system picker gave it. */
  label: string
  /** Epoch millis of the last scan of this folder, or 0. */
  lastScan: number
  /** How that scan went, in a few words. */
  lastResult?: string | null
  /** False when it can no longer be read — an SD card pulled, a grant revoked. */
  readable: boolean
}

export interface FolderSyncStatus {
  /** Every watched folder, in the order they were added. */
  folders: WatchedFolder[]
  /** How many may be watched at once. */
  maxFolders: number
  /** Whether the watch is running. */
  enabled: boolean
  /** How often the backstop scan runs. Per device, never synced. */
  intervalMinutes: number
  /**
   * Whether Android will run the watch promptly, or defer it to save battery.
   *
   * False is not an error and not a misconfiguration — it is the default for
   * every app. It is reported because it is the usual reason a correctly set up
   * watch imports nothing for hours, and there is no way to tell from inside.
   */
  batteryUnrestricted: boolean
}

export interface ScanResult {
  ok: boolean
  imported: number
  skipped: number
  message: string
}

const FolderSync = registerPlugin<FolderSyncPlugin>('FolderSync')

/** Nothing to watch: the folder was never chosen, or has been forgotten. */
const NO_FOLDER: FolderSyncStatus = {
  folders: [], maxFolders: 8, enabled: false, intervalMinutes: 15,
  // Claimed true so an older APK, which cannot answer, does not show a warning
  // about a restriction nobody can check. The prompt would go nowhere.
  batteryUnrestricted: true,
}

export async function folderSyncStatus(): Promise<FolderSyncStatus> {
  if (!isNative()) return NO_FOLDER
  try {
    return await FolderSync.getStatus()
  } catch {
    // An older APK without the plugin. Reported as "no folder", which is what
    // the user sees anyway, rather than breaking the Settings page.
    return NO_FOLDER
  }
}

/**
 * Opens the system folder picker. Resolves with the chosen folder's name, or
 * null if the user backed out.
 *
 * The picker *is* the permission: choosing a directory grants access to that
 * directory and nothing else, which is why auto-import needs no storage
 * permission and cannot read the rest of the phone.
 */
export async function pickSyncFolder(): Promise<string | null> {
  if (!isNative()) return null
  return (await FolderSync.pickFolder()).folder ?? null
}

export async function setFolderSyncEnabled(enabled: boolean): Promise<void> {
  await FolderSync.setEnabled({ enabled })
}

/**
 * Scans immediately.
 *
 * `force` re-offers files this device has already handled. The normal scan skips
 * them, which is what keeps the periodic job cheap — but it also means a workout
 * deleted from the library never comes back, because the file that produced it
 * is still marked as done. Forcing is the way back from that; the server's
 * content-hash check still stops anything still present being imported twice.
 */
export async function scanFolderNow(force = false): Promise<ScanResult> {
  return FolderSync.scanNow({ force })
}

/**
 * How often the backstop scan runs. WorkManager will not go below 15 minutes.
 *
 * This is no longer what decides when a file imports — Android starts the watch
 * when the folder changes — so it only covers what a change notification cannot:
 * files that appeared while the phone was off, and folder providers that never
 * announce their changes.
 */
export async function setFolderSyncInterval(minutes: number): Promise<void> {
  await FolderSync.setInterval({ minutes })
}

/**
 * Opens the system prompt to exempt the app from battery optimisation.
 *
 * Resolves with the state afterwards, read back rather than inferred: the dialog
 * reports the same result code whether it was accepted or dismissed.
 */
export async function requestBatteryExemption(): Promise<boolean> {
  if (!isNative()) return true
  try {
    return (await FolderSync.requestBatteryExemption()).batteryUnrestricted
  } catch {
    return false
  }
}

/**
 * Stops watching one folder and hands its grant back, leaving the others.
 *
 * There is no "stop watching everything" beside this. Removing the last folder
 * turns the watch off natively, so a second control would be a second way to
 * reach a state this one already reaches.
 */
export async function removeSyncFolder(uri: string): Promise<void> {
  await FolderSync.removeFolder({ uri })
}
