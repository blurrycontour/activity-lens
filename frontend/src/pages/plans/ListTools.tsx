import { CheckCheck } from 'lucide-react'
import SearchInput from '../../components/SearchInput'
import SelectionBar from '../../components/SelectionBar'

/**
 * The row above a list of plans or sessions: search and sort, or — once
 * something is selected — what to do with the selection.
 *
 * One row, two states, rather than a selection bar appearing under the search
 * field. Two rows of chrome above a list on a phone is most of the screen, and
 * search is not a thing you want while picking things to delete. Both tabs use
 * this, and the selection half is the same component Workouts uses, so holding
 * a row means the same thing everywhere in the app.
 */
export default function ListTools({
  query, onQuery, placeholder, label, noun,
  sort, selecting, count, total, allSelected,
  onSelect, onToggleAll, onDelete, onCancel,
}: {
  query: string
  onQuery: (v: string) => void
  placeholder: string
  label: string
  /** Plural noun for "Select all N …". */
  noun: string
  /** The sort control, which differs between the two lists. */
  sort: React.ReactNode
  selecting: boolean
  count: number
  total: number
  allSelected: boolean
  onSelect: () => void
  onToggleAll: () => void
  onDelete: () => void
  onCancel: () => void
}) {
  if (selecting) {
    return (
      <SelectionBar
        count={count}
        total={total}
        allSelected={allSelected}
        noun={noun}
        compact
        onCancel={onCancel}
        onToggleAll={onToggleAll}
        onDelete={onDelete}
      />
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
