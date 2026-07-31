import { registerPlugin } from '@capacitor/core'
import { isNative } from '../serverConfig'

/** Implemented by mobile/android/.../FolderSyncPlugin.java. */
interface FolderSyncPlugin {
  getStatus(): Promise<FolderSyncStatus>
  pickFolder(): Promise<{ folder?: string | null }>
  setEnabled(options: { enabled: boolean }): Promise<void>
  scanNow(): Promise<ScanResult>
  disable(): Promise<void>
}

export interface FolderSyncStatus {
  /** Display name of the watched folder, or null when none is chosen. */
  folder?: string | null
  /** Whether the periodic scan is running. */
  enabled: boolean
  /** Epoch millis of the last scan, or 0. */
  lastScan: number
  /** How the last scan went, in a few words. */
  lastResult?: string | null
  /** False when the folder can no longer be read — an SD card pulled, a grant revoked. */
  readable: boolean
}

export interface ScanResult {
  ok: boolean
  imported: number
  skipped: number
  message: string
}

const FolderSync = registerPlugin<FolderSyncPlugin>('FolderSync')

/** Nothing to watch: the folder was never chosen, or has been forgotten. */
const NO_FOLDER: FolderSyncStatus = { folder: null, enabled: false, lastScan: 0, readable: false }

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

export async function scanFolderNow(): Promise<ScanResult> {
  return FolderSync.scanNow()
}

/** Forgets the folder, hands the grant back, and stops the schedule. */
export async function disableFolderSync(): Promise<void> {
  await FolderSync.disable()
}
