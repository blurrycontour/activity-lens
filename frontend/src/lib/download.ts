// Saving files from the app.
//
// The workout list and the workout detail page both offered a GPX export and
// each carried its own copy of the template and the anchor-click download. They
// live here instead so there is one implementation to change — notably in the
// native app, where `<a download>` silently does nothing inside an Android
// WebView and has to go through a native file-save bridge.

import { type Workout } from '../data/workouts'
import { api } from './api'

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
 * Phase 3 adds a native branch here (Capacitor Filesystem + Share), which is
 * the reason every caller goes through this one function.
 */
export function saveFile(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Exports a workout's route as a GPX file. */
export function downloadWorkoutGPX(w: Workout): void {
  const blob = new Blob([workoutToGPX(w)], { type: 'application/gpx+xml' })
  saveFile(workoutFileName(w, 'gpx'), blob)
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
  saveFile(filename || workoutFileName(w, 'original'), blob)
}
