import { ArrowLeft } from 'lucide-react'

interface PageHeaderProps {
  title: string
  subtitle?: string
  /** When given, a back arrow is shown to its left. */
  onBack?: () => void
  /** Controls aligned to the right of the title, e.g. a save button. */
  actions?: React.ReactNode
  /**
   * A control sitting directly beside the title, for when the title *is* the
   * editable thing — a plan's name, say. Distinct from `actions`, which is a
   * group aligned to the far right and drops onto its own line on a phone.
   */
  titleAction?: React.ReactNode
  /**
   * Keeps `actions` on the title's row on a phone instead of dropping it below.
   *
   * The default exists because a group of labelled buttons squeezes the title
   * to a few hyphenated characters. A single icon button does not, and pushing
   * one onto its own line left it sitting under the back arrow looking like it
   * belonged to nothing.
   */
  compactActions?: boolean
  /**
   * A line under the subtitle, for what the title cannot hold: whose item this
   * is, most of the time. Inside the header rather than at the top of the page
   * body so it reads as part of the identity of the thing, which is where the
   * workout page has always put it.
   */
  meta?: React.ReactNode
  /**
   * Chips that belong to the thing rather than to the page — its kind, whether
   * it is shared — shown on the subtitle's row.
   *
   * Beside the subtitle and not beside the title, because the title is the one
   * piece of text here with no length limit. A workout called "Morning run
   * along the canal and back" with two chips after it wrapped onto three lines
   * on a phone, and the chips are short and fixed-width where the name is
   * neither. The date line has room to spare and nothing that suffers from
   * sharing it.
   */
  subtitleAction?: React.ReactNode
}

/**
 * The bar at the top of a page: title, optional subtitle, optional back arrow.
 *
 * Every page had its own copy of this markup with the same inline styles, which
 * is how they drifted apart. Drilling into a settings category uses the same
 * header as opening a workout, so going one level deep looks the same wherever
 * you do it.
 */
export default function PageHeader({ title, subtitle, onBack, actions, titleAction, compactActions, meta, subtitleAction }: PageHeaderProps) {
  return (
    <div className="page-header page-header-row">
      {onBack && (
        <button className="btn-icon page-header-back" onClick={onBack} aria-label="Back">
          <ArrowLeft size={18} />
        </button>
      )}
      <div className="page-header-text">
        <div className="page-header-title-row">
          <h1 className="page-header-title">{title}</h1>
          {titleAction}
        </div>
        {(subtitle || subtitleAction) && (
          <div className="page-header-sub-row">
            {subtitle && <p className="page-header-sub">{subtitle}</p>}
            {subtitleAction}
          </div>
        )}
        {meta}
      </div>
      {/* Wrapped so the phone layout can drop it onto its own line. Filters
          sharing a row with the title left the subtitle a few characters wide
          and hyphenating, which is what a header is meant to prevent. */}
      {actions && (
        <div className={`page-header-actions${compactActions ? ' compact' : ''}`}>{actions}</div>
      )}
    </div>
  )
}
