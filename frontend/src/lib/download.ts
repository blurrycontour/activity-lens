// Saving files from the app.
//
// Several places save something — the original activity file, a share card —
// and each used to carry its own anchor-click download. They live here instead
// so there is one implementation to change, notably in the native app, where
// `<a download>` silently does nothing inside an Android WebView and has to go
// through a native file-save bridge.

import { type Workout } from '../data/workouts'
import { api } from './api'
import { nativeToast, saveFileNative, shareFileNative } from './native/shell'
import { isNative } from './serverConfig'

/** Filename a workout export is offered under, e.g. `Morning_Run_2026-07-20.gpx`. */
export function workoutFileName(w: Workout, ext: string): string {
  // Strip characters that are illegal in filenames on common platforms.
  const safe = w.name.replace(/\s+/g, '_').replace(/[/\\?%*:|"<>]/g, '') || 'workout'
  return `${safe}_${w.date}.${ext}`
}

/**
 * Saves a blob to the user's device under the given filename.
 *
 * The two platforms have nothing in common here, which is exactly why every
 * caller goes through this one function. A browser takes an anchor pointed at a
 * blob URL; an Android WebView does not — `blob:` is one of the two schemes
 * Capacitor's navigation handler deliberately declines to pass to the system,
 * and `download` is not implemented, so the click did nothing and reported
 * nothing. Native writes the bytes to the Downloads folder instead, and says so,
 * because there is no download shelf to notice it.
 */
export async function saveFile(filename: string, blob: Blob): Promise<void> {
  if (isNative()) {
    const path = await saveFileNative(filename, blob)
    await nativeToast(`Saved to ${path}`)
    return
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Offers a file to whatever the platform uses for sending things to people.
 *
 * Three routes, in order of how much they respect the intent: the Android share
 * sheet, the Web Share API where the browser has one that takes files, and a
 * plain download where it does not. The last is a real fallback rather than a
 * failure — a desktop browser with no share sheet has a downloads folder and an
 * email client, and the file is what the user actually wanted.
 *
 * Returns whether it truly shared, so the caller can say "saved" rather than
 * implying it went somewhere.
 */
export async function shareFile(filename: string, blob: Blob, opts: { title?: string; text?: string } = {}): Promise<boolean> {
  if (isNative()) {
    await shareFileNative(filename, blob, opts)
    return true
  }
  const file = new File([blob], filename, { type: blob.type })
  // canShare({ files }) is the only reliable test: several browsers expose
  // navigator.share while refusing anything but a URL, and calling it with a
  // file there throws rather than degrading.
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: opts.title, text: opts.text })
      return true
    } catch (err) {
      // The user dismissing the sheet is not an error, and must not fall
      // through to downloading a file they just declined to send.
      if (err instanceof DOMException && err.name === 'AbortError') return true
    }
  }
  await saveFile(filename, blob)
  return false
}

/**
 * Reports a failed save.
 *
 * The export buttons are scattered across list rows and menus with nowhere to
 * put an error message, and a save that fails silently is what this whole change
 * is fixing. On web the console is the honest answer — a browser download that
 * fails has already told the user itself.
 */
export function reportSaveFailure(err: unknown): void {
  const message = err instanceof Error ? err.message : 'could not save the file'
  if (isNative()) void nativeToast(message)
  else console.error(message)
}

/**
 * Downloads the file a workout was imported from, exactly as it arrived.
 *
 * The only export there is, and deliberately so. There used to be a second one
 * that re-serialised a GPX from the parsed timelines, which lost device
 * extensions, the original timestamps and every field the importer does not
 * model — and produced an empty document for any workout with no route, which
 * is every treadmill run and indoor ride in the library. This is the bytes
 * themselves, which is also the only form worth moving to another app.
 *
 * Only available when the server was archiving originals at import time, so
 * callers should gate on `w.hasOriginal`.
 */
export async function downloadWorkoutOriginal(w: Workout): Promise<void> {
  const { blob, filename } = await api.getWorkoutOriginal(w.id)
  // The server names the file, since it knows what the upload was called. The
  // fallback keeps the extension it was stored under rather than assuming gpx.
  await saveFile(filename || workoutFileName(w, 'original'), blob)
}
