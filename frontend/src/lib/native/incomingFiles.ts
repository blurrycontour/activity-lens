import { Capacitor, registerPlugin } from '@capacitor/core'
import { isNative } from '../serverConfig'

/**
 * Workout files shared into the Android app, or opened with it.
 *
 * The native counterpart of `lib/shareTarget.ts`, which does the same job for
 * the PWA through the service worker. Android honours neither `share_target`
 * nor `file_handlers` for an installed web app, so the shell registers real
 * intent filters and hands what arrives over here — see
 * mobile/android/.../IncomingFiles.java.
 *
 * Both routes end in the same place: `File[]`, straight into the import modal.
 */

/** Implemented by mobile/android/.../IncomingFilesPlugin.java. */
interface IncomingFilesPlugin {
  consume(): Promise<{ files?: IncomingFile[] }>
  addListener(event: 'incomingFiles', fn: () => void): Promise<{ remove: () => Promise<void> }>
}

interface IncomingFile {
  /** The name the sending app gave it, used as the File's name. */
  name: string
  /** Absolute path to the shell's own copy of the bytes. */
  path: string
  size: number
  mimeType?: string
}

const IncomingFiles = registerPlugin<IncomingFilesPlugin>('IncomingFiles')

/**
 * Claims every file from the most recent share, in the order they arrived.
 *
 * Returns an empty array on the web, where the service worker route applies
 * instead, and whenever there is nothing waiting.
 *
 * The bytes are read over `fetch` rather than carried across the bridge:
 * `convertFileSrc` turns a path the shell owns into a URL the WebView can
 * request, which keeps a large export — a Strava zip runs to hundreds of
 * megabytes — out of the bridge and out of a base64 string, and lets the
 * browser back the Blob with disk rather than heap.
 */
export async function takeNativeIncomingFiles(): Promise<File[]> {
  if (!isNative()) return []
  let pending: IncomingFile[]
  try {
    const result = await IncomingFiles.consume()
    pending = result.files ?? []
  } catch {
    // The plugin is missing, which means an older shell around a newer bundle.
    // Nothing is waiting that this build could deliver.
    return []
  }

  const files: File[] = []
  for (const entry of pending) {
    try {
      const response = await fetch(Capacitor.convertFileSrc(entry.path))
      if (!response.ok) continue
      const blob = await response.blob()
      if (blob.size === 0) continue
      files.push(new File([blob], entry.name, { type: entry.mimeType || 'application/octet-stream' }))
    } catch {
      // One unreadable file should not cost the user the rest of the batch.
      continue
    }
  }
  return files
}

/**
 * Runs `fn` whenever a share arrives while the app is already open.
 *
 * The event says only that something is waiting; the files come from
 * takeNativeIncomingFiles() either way, so a share that arrives before anything
 * is listening is picked up by the same call on the next check rather than lost.
 *
 * Returns a cleanup function, and a no-op one on the web.
 */
export function onNativeIncomingFiles(fn: () => void): () => void {
  if (!isNative()) return () => {}
  const handle = IncomingFiles.addListener('incomingFiles', fn)
  return () => { handle.then(h => h.remove()).catch(() => {}) }
}
