import { Info, X } from 'lucide-react'
import Modal from './Modal'
import { extraSeriesMeta } from '../lib/extraSeries'
import type { Workout } from '../data/workouts'

/**
 * Where a workout came from and what arrived with it.
 *
 * Everything else on the page is the workout — how far, how fast, how it felt.
 * This is the workout's paperwork: when it entered the library, by which route,
 * in what format, and which of the things a device can record this particular
 * file actually carried. All of it exists somewhere in the app already, in the
 * sense that a missing chart implies a missing series; none of it is *stated*,
 * so "why is there no cadence on this one" has no answer short of guessing.
 *
 * Owner-only facts stay owner-only by arriving that way: the format and the
 * archived-file flag are computed from a field the server clears for anyone who
 * does not own the workout, so a shared workout simply has fewer rows.
 */
export default function WorkoutInfoDialog({ workout: w, onClose }: {
  workout: Workout & { originalFormat?: string; hasOriginal?: boolean }
  onClose: () => void
}) {
  const rows = [
    ['Added to library', fmtStamp(w.createdAt)],
    ['How it arrived', SOURCE_LABEL[w.source ?? ''] ?? (w.source || 'Not recorded')],
    ['File format', w.originalFormat || (w.source === 'manual' ? 'No file' : '')],
    // Only worth a row when there is one: "no" here would read as a fault
    // rather than as a setting that was off when this was imported.
    ['Original file', w.hasOriginal ? 'Kept on the server' : ''],
    ['Started', fmtStamp(w.startTime ?? w.date)],
    ['Pauses', w.pauses?.length ? String(w.pauses.length) : ''],
    ['Track', w.route?.length ? `${w.route.length.toLocaleString()} points` : ''],
    ['Recorded', recorded(w)],
  ].filter(([, value]) => value) as [string, string][]

  return (
    <Modal onClose={onClose} label="Workout details">
      <div className="modal-box about-box">
        <div className="dialog-head">
          <h3 className="dialog-title"><Info size={15} /> Details</h3>
          <button className="btn-icon" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <p className="field-hint" style={{ marginBottom: 0 }}>
          Where this workout came from and what its file carried.
        </p>
        <dl className="fact-grid">
          {rows.map(([label, value]) => (
            <div key={label} style={{ display: 'contents' }}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Modal>
  )
}

/** How a workout got here, said the way the import screens say it. */
const SOURCE_LABEL: Record<string, string> = {
  upload: 'File upload',
  manual: 'Entered by hand',
  autoimport: 'Watched folder',
  healthconnect: 'Health Connect',
}

/**
 * Which measurements this file actually contains.
 *
 * The one fact on this page that cannot be read off the page: a chart that is
 * absent looks the same whether the device did not record it, the format
 * cannot carry it, or the import dropped it. Naming what is here answers the
 * question by elimination.
 */
function recorded(w: Workout): string {
  const names = [
    w.hrTimeline?.length && 'heart rate',
    w.paceTimeline?.length && 'pace',
    w.elevTimeline?.length && 'elevation',
    w.cadenceTimeline?.length && 'cadence',
    ...Object.entries(w.extraSeries ?? {})
      .filter(([, points]) => points.length > 0)
      .map(([name]) => extraSeriesMeta(name).label.toLowerCase()),
  ].filter(Boolean) as string[]
  return names.join(', ')
}

/** An RFC 3339 stamp as a date and a time of day, or nothing. */
function fmtStamp(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
