// The import pipeline: turn whatever the user handed us into workouts.
//
// Files reach the app from four places — the file picker, a drag and drop, the
// Android share sheet, and a desktop "Open with" — and by the time they get
// here they are all just a File[]. Everything below is deliberately free of
// React so the sequencing and the archive handling can be tested directly.
//
// The shape of a run is:
//
//   expand    unwrap .zip / .gz into the workout files inside
//   preflight hash everything, ask the server what it already has, and parse
//             only what is genuinely new
//   runImport upload the files the user kept, a few at a time
//
// Preflight exists because a bulk import is mostly duplicates in practice: the
// second import of an export archive, or any rescan of a folder, is entirely
// files the server already holds. Hashing locally and asking once turns that
// from "upload everything again" into a single small request.

import { unzip, gunzipSync } from 'fflate'
import { api, ApiError } from './api'
import { type Workout, type WorkoutType } from '../data/workouts'

/** Extensions the importer can parse. Anything else is reported, not silently dropped. */
export const WORKOUT_EXTENSIONS = ['gpx', 'tcx'] as const

/** Archive wrappers that are unpacked before looking at what is inside. */
const ARCHIVE_EXTENSIONS = ['zip', 'gz'] as const

// Zip bombs are cheap to make and this runs in the user's tab, so expansion is
// bounded on both axes. The limits are far above a real export — a decade of
// daily training is a few thousand files — and exist only to fail loudly
// instead of freezing the browser.
const MAX_EXPANDED_ENTRIES = 1000
const MAX_EXPANDED_BYTES = 500 * 1024 * 1024

// The server accepts 500 hashes per request (workout.MaxHashBatch).
const HASH_BATCH = 500

// How many uploads run at once. The backend holds a single SQLite connection,
// so more than a few just queue on the write lock; this is enough to keep the
// network busy while one is being parsed.
const UPLOAD_CONCURRENCY = 3

/** Why a file cannot be imported, when it cannot. */
export type SkipReason = 'unsupported' | 'empty' | 'too-many' | 'too-large'

/** A file that will not be imported, and the reason, so the UI can say so. */
export interface SkippedFile {
  name: string
  reason: SkipReason
}

export interface ExpandResult {
  files: File[]
  skipped: SkippedFile[]
}

/** Lowercased final extension, without the dot. */
function extensionOf(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase()
}

function isWorkoutFile(name: string): boolean {
  return (WORKOUT_EXTENSIONS as readonly string[]).includes(extensionOf(name))
}

function isArchive(name: string): boolean {
  return (ARCHIVE_EXTENSIONS as readonly string[]).includes(extensionOf(name))
}

/** Drops a `.gz` suffix, so `12345.gpx.gz` is recognised as a `.gpx`. */
function withoutGz(name: string): string {
  return extensionOf(name) === 'gz' ? name.slice(0, -3) : name
}

/**
 * Unwraps archives into the workout files inside them.
 *
 * This is what makes a Strava or Garmin export importable at all: those are a
 * ZIP of `activities/*.gpx.gz`, so both layers have to come off before there is
 * anything the parser recognises. Doing it in the browser rather than on the
 * server avoids uploading a multi-hundred-megabyte archive, and keeps zip-bomb
 * handling out of the backend entirely.
 *
 * Plain workout files pass through untouched. Anything else — the `activities.csv`
 * in a Strava export, a `.fit` this build cannot parse yet — is returned in
 * `skipped` rather than dropped, so the UI can account for every file the user
 * selected.
 */
export async function expand(input: File[]): Promise<ExpandResult> {
  const files: File[] = []
  const skipped: SkippedFile[] = []
  let bytes = 0

  /** Adds an expanded entry, enforcing the bomb guards. Returns false when full. */
  const take = (name: string, data: Uint8Array): boolean => {
    if (files.length >= MAX_EXPANDED_ENTRIES) {
      skipped.push({ name, reason: 'too-many' })
      return false
    }
    bytes += data.byteLength
    if (bytes > MAX_EXPANDED_BYTES) {
      skipped.push({ name, reason: 'too-large' })
      return false
    }
    files.push(new File([data as BlobPart], name, { type: 'application/octet-stream' }))
    return true
  }

  for (const file of input) {
    if (!isArchive(file.name)) {
      if (!isWorkoutFile(file.name)) skipped.push({ name: file.name, reason: 'unsupported' })
      else if (file.size === 0) skipped.push({ name: file.name, reason: 'empty' })
      else files.push(file)
      continue
    }

    const raw = new Uint8Array(await file.arrayBuffer())

    // A bare .gpx.gz, as shared straight out of an export folder.
    if (extensionOf(file.name) === 'gz') {
      const inner = withoutGz(file.name)
      if (!isWorkoutFile(inner)) {
        skipped.push({ name: file.name, reason: 'unsupported' })
        continue
      }
      try {
        if (!take(inner, gunzipSync(raw))) break
      } catch {
        skipped.push({ name: file.name, reason: 'unsupported' })
      }
      continue
    }

    let entries: Record<string, Uint8Array>
    try {
      entries = await unzipAsync(raw)
    } catch {
      skipped.push({ name: file.name, reason: 'unsupported' })
      continue
    }

    let full = false
    for (const [path, data] of Object.entries(entries)) {
      // Directory entries, and the macOS resource forks that ride along in
      // archives made on a Mac.
      if (path.endsWith('/') || path.startsWith('__MACOSX/')) continue

      const leaf = path.slice(path.lastIndexOf('/') + 1)
      if (!leaf) continue

      let name = leaf
      let bytesOut = data
      if (extensionOf(leaf) === 'gz') {
        name = withoutGz(leaf)
        if (!isWorkoutFile(name)) {
          skipped.push({ name: leaf, reason: 'unsupported' })
          continue
        }
        try {
          bytesOut = gunzipSync(data)
        } catch {
          skipped.push({ name: leaf, reason: 'unsupported' })
          continue
        }
      } else if (!isWorkoutFile(leaf)) {
        skipped.push({ name: leaf, reason: 'unsupported' })
        continue
      }

      if (bytesOut.byteLength === 0) {
        skipped.push({ name, reason: 'empty' })
        continue
      }
      if (!take(name, bytesOut)) { full = true; break }
    }
    if (full) break
  }

  return { files, skipped }
}

/** Promise wrapper around fflate's callback unzip. */
function unzipAsync(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(data, (err, out) => (err ? reject(err) : resolve(out)))
  })
}

/**
 * SHA-256 of a file's bytes, hex encoded.
 *
 * Must match what the server computes in parseWorkoutUpload — `sha256(data)`
 * over the raw upload — because that value is the workout's import identity.
 * If the two ever disagree, every file looks new and nothing is ever skipped.
 */
export async function hashFile(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Status of one file as it moves through preflight and import. */
export type ImportStatus =
  | 'ready'      // parsed, not yet imported
  | 'duplicate'  // the server already has this exact file
  | 'error'      // could not be parsed
  | 'importing'
  | 'imported'
  | 'failed'

export interface ImportItem {
  /** Stable across the whole run, so React keys survive re-ordering. */
  id: string
  file: File
  hash: string
  status: ImportStatus
  /** Parsed metrics, present once preflight has previewed the file. */
  preview?: Workout
  /**
   * Sport chosen for this file, overruling what the file itself says.
   *
   * Per file rather than per batch: an export archive is a year of mixed
   * activities, and one setting across all of them can only ever be right for
   * the files that already agreed with it. Absent means the file decides.
   */
  type?: WorkoutType
  /** The stored workout, once imported (or the existing one, if duplicate). */
  workout?: Workout
  /** Why this file failed, for the row that shows it. */
  error?: string
}

/**
 * Works out what each file would do before anything is written.
 *
 * Two passes on purpose. The hashes go up in one batch and come back marked as
 * already-imported or not; only the genuinely new files are then parsed, one
 * request each. On a re-import — the common case for an archive or a rescan —
 * that second pass is empty and the whole preflight is a single request.
 *
 * `onProgress` fires as each file resolves so a large batch is not a frozen
 * screen, and `signal` abandons the run promptly.
 */
export async function preflight(
  files: File[],
  opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<ImportItem[]> {
  const { signal, onProgress } = opts

  const items: ImportItem[] = []
  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal)
    items.push({ id: `${i}-${files[i].name}`, file: files[i], hash: await hashFile(files[i]), status: 'ready' })
  }

  // One question for the whole batch, chunked to the server's limit.
  const known = new Set<string>()
  for (let i = 0; i < items.length; i += HASH_BATCH) {
    throwIfAborted(signal)
    const chunk = items.slice(i, i + HASH_BATCH).map(it => it.hash)
    try {
      const res = await api.knownImports(chunk)
      res.known.forEach(h => known.add(h))
    } catch {
      // Not fatal: without this the files are merely previewed and uploaded as
      // usual, and the server's own dedupe still prevents a second copy.
      break
    }
  }

  let done = 0
  const report = () => onProgress?.(++done, items.length)

  await mapLimit(items, UPLOAD_CONCURRENCY, async item => {
    throwIfAborted(signal)
    if (known.has(item.hash)) {
      item.status = 'duplicate'
      report()
      return
    }
    try {
      const preview = await api.previewWorkout(item.file)
      item.preview = preview
      // A file can still be a duplicate here: the hash check only covers
      // uploads, and the preview resolves the (source, external id) identity.
      item.status = preview.duplicate ? 'duplicate' : 'ready'
    } catch (err) {
      item.status = 'error'
      item.error = err instanceof ApiError ? err.message : 'could not read this file'
    }
    report()
  })

  return items
}

export interface ImportRunResult {
  imported: number
  duplicates: number
  failed: number
}

/**
 * Uploads the given items, a few at a time, updating each as it goes.
 *
 * One request per file rather than a batch endpoint: a corrupt file then fails
 * on its own without taking the rest of the run with it, progress is real, and
 * no single request has to carry hundreds of megabytes.
 *
 * Every upload sets `deferChecks`, and the gear/goal evaluation runs once at the
 * end — those checks each re-read the whole library, so per-file they make a
 * large import quadratic.
 */
export async function runImport(
  items: ImportItem[],
  opts: {
    equipmentIds?: string[]
    signal?: AbortSignal
    onItemChange?: (item: ImportItem) => void
    onProgress?: (done: number, total: number) => void
  } = {},
): Promise<ImportRunResult> {
  const { equipmentIds, signal, onItemChange, onProgress } = opts
  const result: ImportRunResult = { imported: 0, duplicates: 0, failed: 0 }
  const queue = items.filter(it => it.status === 'ready')
  let done = 0

  // Only defer when there is enough of a batch for it to matter; a single file
  // should still see its goals update without a second request.
  const defer = queue.length > 1

  await mapLimit(queue, UPLOAD_CONCURRENCY, async item => {
    if (signal?.aborted) return
    item.status = 'importing'
    onItemChange?.(item)
    try {
      const res = await api.importWorkout(item.file, item.type, undefined, equipmentIds, defer)
      item.workout = res
      item.status = res.duplicate ? 'duplicate' : 'imported'
      if (res.duplicate) result.duplicates++
      else result.imported++
    } catch (err) {
      item.status = 'failed'
      item.error = err instanceof ApiError ? err.message : 'import failed'
      result.failed++
    }
    onItemChange?.(item)
    onProgress?.(++done, queue.length)
  })

  if (defer && result.imported > 0) {
    // Best-effort: the workouts are already stored, and a missed run of the
    // checks only delays a gear or goal notification to the next import.
    await api.finalizeImport().catch(() => {})
  }
  return result
}

/** Runs `fn` over `items` with at most `limit` in flight, preserving no order. */
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      await fn(items[next++])
    }
  })
  await Promise.all(workers)
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
}

/** Counts for the import button and its breakdown line. */
export function summarize(items: ImportItem[], skipped: SkippedFile[] = []) {
  const ready = items.filter(i => i.status === 'ready').length
  const duplicates = items.filter(i => i.status === 'duplicate').length
  const errors = items.filter(i => i.status === 'error').length + skipped.length
  return { ready, duplicates, errors, total: items.length + skipped.length }
}
