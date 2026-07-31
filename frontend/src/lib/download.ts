// Saving files from the app.
//
// The workout list and the workout detail page both offered a GPX export and
// each carried its own copy of the template and the anchor-click download. They
// live here instead so there is one implementation to change — notably in the
// native app, where `<a download>` silently does nothing inside an Android
// WebView and has to go through a native file-save bridge.

import { type Workout } from '../data/workouts'
import { api } from './api'
import { nativeToast, saveFileNative } from './native/shell'
import { isNative } from './serverConfig'

/** Escapes text for inclusion in XML character data or an attribute value. */
function escapeXML(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Builds a minimal GPX document for a workout's recorded route. */
export function workoutToGPX(w: Workout): string {
  const name = escapeXML(w.name)
  const points = w.route
    .map(([lat, lng]) => `      <trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"></trkpt>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Activity Lens">
  <metadata><name>${name}</name></metadata>
  <trk>
    <name>${name}</name>
    <type>${escapeXML(w.type)}</type>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>`
}

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

/** Exports a workout's route as a GPX file. */
export async function downloadWorkoutGPX(w: Workout): Promise<void> {
  const blob = new Blob([workoutToGPX(w)], { type: 'application/gpx+xml' })
  await saveFile(workoutFileName(w, 'gpx'), blob)
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
 * Distinct from `downloadWorkoutGPX`, which re-serializes a GPX from the parsed
 * timelines: that loses device extensions, the original timestamps and every
 * field the importer does not model. This is the bytes themselves, which is
 * what matters when moving a history somewhere else.
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
