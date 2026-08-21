import { CheckCircle, AlertCircle, Info, Loader2, FileText, X } from 'lucide-react'
import { type ImportItem, type SkippedFile, type SkipReason } from '../lib/importQueue'
import { fmtDist, type WorkoutType } from '../data/workouts'
import SportDropdown from './SportDropdown'

/** Human wording for why a file will not be imported. */
const SKIP_TEXT: Record<SkipReason, string> = {
  unsupported: 'Not a .fit, .gpx or .tcx file',
  empty: 'File is empty',
  'too-many': 'Skipped — too many files in this archive',
  'too-large': 'Skipped — archive too large',
}

/** Colour and label per status. Only the states a row can actually be in. */
function chipFor(item: ImportItem): { label: string; color: string; icon: React.ReactNode } {
  switch (item.status) {
    case 'ready':
      return { label: 'Ready', color: 'var(--primary)', icon: <CheckCircle size={13} /> }
    case 'duplicate':
      return { label: 'Already imported', color: 'var(--text-3)', icon: <Info size={13} /> }
    case 'error':
    case 'failed':
      return { label: item.error || 'Failed', color: 'var(--danger)', icon: <AlertCircle size={13} /> }
    case 'importing':
      return {
        label: 'Importing…',
        color: 'var(--text-3)',
        icon: <Loader2 size={13} className="spin" />,
      }
    case 'imported':
      return { label: 'Imported', color: 'var(--primary)', icon: <CheckCircle size={13} /> }
  }
}

/**
 * One line of parsed detail, so a row is identifiable beyond its filename.
 *
 * No sport here any more: it has its own control on the row, and printing it
 * twice invites the two to disagree the moment one is changed.
 */
function subtitle(item: ImportItem): string {
  const p = item.preview
  if (!p) return `${(item.file.size / 1024).toFixed(1)} KB`
  const bits = [p.date]
  if (p.distance > 0) bits.push(fmtDist(p.distance))
  return bits.filter(Boolean).join(' · ')
}

/**
 * The per-file view of a multi-file import.
 *
 * Purely presentational — the parent owns the queue and the actions. Its job is
 * to make a batch legible: which files will import, which the server already
 * has, and which could not be read, without the user having to open anything.
 *
 * Rows stay in place as their status changes rather than regrouping, so a list
 * being worked through does not reorder under the reader.
 */
export default function BatchImportList({
  items,
  skipped,
  busyLabel,
  progress,
  onRemove,
  onTypeChange,
}: {
  items: ImportItem[]
  skipped: SkippedFile[]
  /** Set while preflight or import is running; disables removal. */
  busyLabel?: string
  progress?: { done: number; total: number }
  onRemove?: (id: string) => void
  /** Set the sport for one file. Omitted once the import is under way. */
  onTypeChange?: (id: string, type: WorkoutType) => void
}) {
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div>
      {busyLabel && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>
            <Loader2 size={13} className="spin" style={{ flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{busyLabel}</span>
            {progress && progress.total > 0 && (
              <span style={{ fontFamily: 'var(--font-mono)' }}>{progress.done}/{progress.total}</span>
            )}
          </div>
          <div style={{ height: 4, borderRadius: 99, background: 'var(--bg-3)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: 'var(--primary)', transition: 'width 0.2s' }} />
          </div>
        </div>
      )}

      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          background: 'var(--bg-3)',
          maxHeight: 320,
          overflowY: 'auto',
        }}
      >
        {items.map((item, i) => {
          const chip = chipFor(item)
          const dimmed = item.status === 'duplicate' || item.status === 'error'
          // Only a file that will actually be imported gets a sport control: a
          // duplicate resolves to the workout already stored and an unreadable
          // one to nothing, so on both the choice would have no effect.
          const canSetType = onTypeChange && item.status === 'ready' && item.preview
          return (
            <div
              key={item.id}
              className="batch-row"
              style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border)', opacity: dimmed ? 0.6 : 1 }}
            >
              <FileText size={15} className="batch-row-icon" />
              <div className="batch-row-main">
                <div className="batch-row-name">{item.preview?.name || item.file.name}</div>
                <div className="batch-row-meta">{subtitle(item)}</div>
              </div>
              {canSetType ? (
                <div className="batch-row-sport">
                  <SportDropdown
                    value={item.type ?? item.preview!.type}
                    onChange={t => onTypeChange(item.id, t)}
                  />
                </div>
              ) : <span className="batch-row-sport" />}
              <span className="batch-row-status" style={{ color: chip.color }}>
                {chip.icon}
                <span>{chip.label}</span>
              </span>
              {onRemove && !busyLabel ? (
                <button className="btn-icon batch-row-remove" title="Remove from this import" onClick={() => onRemove(item.id)}>
                  <X size={13} />
                </button>
              ) : <span className="batch-row-remove" />}
            </div>
          )
        })}

        {/* Files that never became candidates. Listed rather than counted alone,
            so "45 selected, 42 importing" is always accountable. */}
        {skipped.map((s, i) => (
          <div
            key={`skip-${s.name}-${i}`}
            className="batch-row"
            style={{
              borderTop: items.length === 0 && i === 0 ? 'none' : '1px solid var(--border)',
              opacity: 0.55,
            }}
          >
            <FileText size={15} className="batch-row-icon" />
            <div className="batch-row-main">
              <div className="batch-row-name">{s.name}</div>
            </div>
            <span className="batch-row-sport" />
            <span className="batch-row-status">
              <AlertCircle size={13} />
              <span>{SKIP_TEXT[s.reason]}</span>
            </span>
            <span className="batch-row-remove" />
          </div>
        ))}
      </div>
    </div>
  )
}
