import { CheckCheck, Trash2, X } from 'lucide-react'
import SearchInput from '../../components/SearchInput'

/**
 * The row above a list of plans or sessions: search and sort, or — once
 * something is selected — what to do with the selection.
 *
 * One row, two states, rather than a selection bar appearing under the search
 * field. Two rows of chrome above a list on a phone is most of the screen, and
 * search is not a thing you want while picking things to delete. Both tabs use
 * this so they behave the same way, which they did not when each grew its own.
 */
export default function ListTools({
  query, onQuery, placeholder, label,
  sort, selecting, count, allSelected,
  onSelect, onToggleAll, onDelete, onCancel,
}: {
  query: string
  onQuery: (v: string) => void
  placeholder: string
  label: string
  /** The sort control, which differs between the two lists. */
  sort: React.ReactNode
  selecting: boolean
  count: number
  allSelected: boolean
  /** Enters selection. Omitted where a list has nothing worth deleting. */
  onSelect: () => void
  onToggleAll: () => void
  onDelete: () => void
  onCancel: () => void
}) {
  if (selecting) {
    return (
      <div className="discover-tools plan-select-bar">
        <span className="plan-num plan-select-count">{count} selected</span>
        <button className="btn btn-ghost" onClick={onToggleAll}>
          <CheckCheck size={14} /> {allSelected ? 'None' : 'All'}
        </button>
        <button className="btn btn-danger" disabled={count === 0} onClick={onDelete}>
          <Trash2 size={14} /> Delete
        </button>
        <button className="btn-icon" onClick={onCancel} aria-label="Leave selection">
          <X size={16} />
        </button>
      </div>
    )
  }

  return (
    <div className="discover-tools">
      <SearchInput value={query} onChange={onQuery} placeholder={placeholder} label={label} minWidth={160} />
      {sort}
      {/* On a desktop there is room for it always. On a phone the row is
          already a search field and a sort, and selecting is reached by
          holding a row — which is where a phone user looks for it. */}
      <button className="btn btn-ghost desktop-only" onClick={onSelect}>
        <CheckCheck size={14} /> Select
      </button>
    </div>
  )
}
