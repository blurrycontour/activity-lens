import { CheckCircle, AlertCircle, Info, Loader2, FileText, X } from 'lucide-react'
import { type ImportItem, type SkippedFile, type SkipReason } from '../lib/importQueue'
import { fmtDist, type WorkoutType } from '../data/workouts'

/** Human wording for why a file will not be imported. */
const SKIP_TEXT: Record<SkipReason, string> = {
  unsupported: 'Not a .gpx or .tcx file',
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

/** One line of parsed detail, so a row is identifiable beyond its filename. */
function subtitle(item: ImportItem, typeOverride?: WorkoutType): string {
  const p = item.preview
  if (!p) return `${(item.file.size / 1024).toFixed(1)} KB`
  // The sport that will actually be stored. Showing the detected one while a
  // chosen sport overrules it would have every row contradict the import.
  const bits = [typeOverride || p.type, p.date]
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
  typeOverride,
}: {
  items: ImportItem[]
  skipped: SkippedFile[]
  /** Set while preflight or import is running; disables removal. */
  busyLabel?: string
  progress?: { done: number; total: number }
  onRemove?: (id: string) => void
  /** Sport chosen in the import window, which overrules what each file says. */
  typeOverride?: WorkoutType
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
          return (
            <div
              key={item.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                opacity: dimmed ? 0.6 : 1,
              }}
            >
              <FileText size={15} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.preview?.name || item.file.name}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>
                  {subtitle(item, typeOverride)}
                </div>
              </div>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: chip.color, flexShrink: 0 }}>
                {chip.icon}
                <span style={{ whiteSpace: 'nowrap' }}>{chip.label}</span>
              </span>
              {onRemove && !busyLabel && (
                <button className="btn-icon" title="Remove from this import" onClick={() => onRemove(item.id)}>
                  <X size={13} />
                </button>
              )}
            </div>
          )
        })}

        {/* Files that never became candidates. Listed rather than counted alone,
            so "45 selected, 42 importing" is always accountable. */}
        {skipped.map((s, i) => (
          <div
            key={`skip-${s.name}-${i}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
              borderTop: items.length === 0 && i === 0 ? 'none' : '1px solid var(--border)',
              opacity: 0.55,
            }}
          >
            <FileText size={15} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.name}
              </div>
            </div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-3)', flexShrink: 0 }}>
              <AlertCircle size={13} />
              <span style={{ whiteSpace: 'nowrap' }}>{SKIP_TEXT[s.reason]}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
