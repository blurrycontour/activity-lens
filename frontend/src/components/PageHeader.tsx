import { ArrowLeft } from 'lucide-react'

interface PageHeaderProps {
  title: string
  subtitle?: string
  /** When given, a back arrow is shown to its left. */
  onBack?: () => void
  /** Controls aligned to the right of the title, e.g. a save button. */
  actions?: React.ReactNode
}

/**
 * The bar at the top of a page: title, optional subtitle, optional back arrow.
 *
 * Every page had its own copy of this markup with the same inline styles, which
 * is how they drifted apart. Drilling into a settings category uses the same
 * header as opening a workout, so going one level deep looks the same wherever
 * you do it.
 */
export default function PageHeader({ title, subtitle, onBack, actions }: PageHeaderProps) {
  return (
    <div className="page-header">
      {onBack && (
        <button className="btn-icon page-header-back" onClick={onBack} aria-label="Back">
          <ArrowLeft size={18} />
        </button>
      )}
      <div className="page-header-text">
        <h1 className="page-header-title">{title}</h1>
        {subtitle && <p className="page-header-sub">{subtitle}</p>}
      </div>
      {/* Wrapped so the phone layout can drop it onto its own line. Filters
          sharing a row with the title left the subtitle a few characters wide
          and hyphenating, which is what a header is meant to prevent. */}
      {actions && <div className="page-header-actions">{actions}</div>}
    </div>
  )
}
