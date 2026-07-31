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
    <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      {onBack && (
        <button className="btn-icon" onClick={onBack} aria-label="Back" style={{ flexShrink: 0 }}>
          <ArrowLeft size={18} />
        </button>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>{title}</h1>
        {subtitle && (
          <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>{subtitle}</p>
        )}
      </div>
      {actions}
    </div>
  )
}
