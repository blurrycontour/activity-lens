import { registerPlugin } from '@capacitor/core'
import { isNative } from '../serverConfig'

/** Implemented by mobile/android/.../ShellPlugin.java. */
interface ShellPlugin {
  saveFile(options: { filename: string; mime: string; base64: string }): Promise<{ path: string }>
  shareFile(options: { filename: string; mime: string; base64: string; title?: string; text?: string }): Promise<void>
  toast(options: { message: string }): Promise<void>
}

const Shell = registerPlugin<ShellPlugin>('Shell')

/** Rejected by saveFileNative when an old Android refuses the storage permission. */
export const STORAGE_DENIED = 'storage-denied'

/**
 * The bridge carries JSON, so bytes cross it as base64.
 *
 * Read as a data URL rather than assembled by hand: FileReader does the encoding
 * natively, in one pass, without the intermediate string a manual loop over a
 * Uint8Array would build — which matters, because the file being saved here can
 * be an entire uploaded activity.
 */
function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('could not read the file'))
    reader.onload = () => {
      const url = String(reader.result)
      // "data:<mime>;base64,<payload>" — only the payload crosses.
      resolve(url.slice(url.indexOf(',') + 1))
    }
    reader.readAsDataURL(blob)
  })
}

/**
 * Saves a file to the phone's Downloads folder. Native only.
 *
 * Returns the path it landed at, so the caller can say where it went — a file
 * that saved silently to somewhere unnamed is barely better than one that did
 * not save at all.
 */
export async function nativeToast(message: string): Promise<void> {
  if (!isNative()) return
  await Shell.toast({ message }).catch(() => {})
}

export async function saveFileNative(filename: string, blob: Blob): Promise<string> {
  if (!isNative()) throw new Error('not running natively')
  const base64 = await toBase64(blob)
  const { path } = await Shell.saveFile({
    filename,
    mime: blob.type || 'application/octet-stream',
    base64,
  })
  return path
}

/**
 * Hands a file to the Android share sheet. Native only.
 *
 * Separate from saveFileNative because the two answer different questions:
 * saving is "keep this", sharing is "send this to someone", and a user who
 * meant the second is not served by a file appearing in Downloads for them to
 * go and find. On the web `navigator.share` does this job; the Android WebView
 * does not implement it, which is the whole reason for the plugin method.
 */
export async function shareFileNative(filename: string, blob: Blob, opts: { title?: string; text?: string } = {}): Promise<void> {
  if (!isNative()) throw new Error('not running natively')
  const base64 = await toBase64(blob)
  await Shell.shareFile({
    filename,
    mime: blob.type || 'application/octet-stream',
    base64,
    ...opts,
  })
}
