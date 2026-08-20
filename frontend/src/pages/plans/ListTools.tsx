import { CheckCheck } from 'lucide-react'
import SelectionBar from '../../components/SelectionBar'

/**
 * The row above a list of plans or sessions: the filters, or — once something
 * is selected — what to do with the selection.
 *
 * One row, two states, rather than a selection bar appearing under the search
 * field. Two rows of chrome above a list on a phone is most of the screen, and
 * search is not a thing you want while picking things to delete. Both tabs use
 * this, and the selection half is the same component Workouts uses, so holding
 * a row means the same thing everywhere in the app.
 *
 * The filters themselves are passed in rather than built here: both tabs now
 * use ItemFilterBar, which already owns the search box, the desktop dropdowns
 * and the phone's sheet. This is only the switch between filtering and
 * selecting, plus the Select button that belongs on the filter row.
 */
export default function ListTools({
  tools, noun, selecting, count, total, allSelected,
  onSelect, onToggleAll, onDelete, onCancel,
}: {
  /** The filter bar for this list, rendered when nothing is selected. */
  tools: (trailing: React.ReactNode) => React.ReactNode
  /** Plural noun for "Select all N …". */
  noun: string
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

  /* On a desktop there is room for Select always. On a phone the row is
     already a search field and the filter button, and selecting is reached by
     holding a row — which is where a phone user looks for it. */
  return tools(
    <button className="btn btn-ghost desktop-only" onClick={onSelect}>
      <CheckCheck size={14} /> Select
    </button>,
  )
}
