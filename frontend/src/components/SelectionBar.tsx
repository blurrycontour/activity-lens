import { CheckCheck, Trash2, X } from 'lucide-react'

/**
 * The toolbar shown while rows are being selected.
 *
 * It takes the place of the row above the list — the filters on Workouts, the
 * search and sort on Plans and History — rather than adding a second bar. The
 * two are never useful at once, and on a phone a second row of chrome costs
 * more than it gives.
 *
 * One component for all three lists, because three copies is how they came to
 * disagree about where the cancel button was and whether "All" said what it
 * would take.
 */
export default function SelectionBar({ count, total, allSelected, noun, compact, onCancel, onToggleAll, onDelete }: {
  count: number
  /** How many rows "all" would take — said out loud, because on a filtered
   *  list it is not obviously the filtered set. */
  total: number
  allSelected: boolean
  /** Plural noun for the accessible label: "workouts", "plans", "sessions". */
  noun: string
  /** Shortens the labels where the row is narrow. */
  compact?: boolean
  onCancel: () => void
  onToggleAll: () => void
  onDelete: () => void
}) {
  const allLabel = allSelected ? `Deselect all` : `Select all ${total} ${noun}`
  return (
    <div className="selection-bar">
      <button className="btn-icon" onClick={onCancel} aria-label="Cancel selection">
        <X size={16} />
      </button>
      <span className="selection-count plan-num">{count} selected</span>
      <button
        className="btn btn-ghost selection-all"
        onClick={onToggleAll}
        aria-label={allLabel}
        title={allLabel}
      >
        <CheckCheck size={15} />
        {/* Shortened rather than dropped on a phone: there is room, and a bare
            glyph has no hover to explain itself there. */}
        {compact ? (allSelected ? 'Clear' : 'All') : allLabel}
      </button>
      <button className="btn btn-ghost selection-delete" disabled={count === 0} onClick={onDelete}>
        <Trash2 size={15} /> Delete
      </button>
    </div>
  )
}
