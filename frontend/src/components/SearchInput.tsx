import { Search } from 'lucide-react'

/**
 * A text input with the magnifier inside its leading edge.
 *
 * Five pages had built this by hand, each repeating the same absolute
 * positioning for the icon and the same left padding on the input to clear it —
 * two numbers that have to agree, in five places, with nothing keeping them
 * that way.
 *
 * `minWidth` is the one thing worth varying: these sit in wrapping toolbars
 * where the search should be the element that grows, and how narrow it may get
 * before wrapping depends on what it shares the row with.
 */
export default function SearchInput({ value, onChange, placeholder, label, minWidth = 180, grow = true, autoFocus }: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  /** Accessible name, when the placeholder is not descriptive enough alone. */
  label?: string
  minWidth?: number
  /** Whether it takes the spare room in its row. */
  grow?: boolean
  /** Only where the dialog exists to be searched. */
  autoFocus?: boolean
}) {
  return (
    <div className="search-field" style={{ flex: grow ? 1 : undefined, minWidth }}>
      <Search size={14} className="search-field-icon" />
      <input
        className="input"
        placeholder={placeholder}
        aria-label={label}
        value={value}
        onChange={e => onChange(e.target.value)}
        autoFocus={autoFocus}
      />
    </div>
  )
}
