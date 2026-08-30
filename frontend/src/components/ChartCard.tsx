import InfoTip from './InfoTip'

interface ChartCardProps {
  title: string
  /** Short line under the title — always visible. */
  description?: string
  /** Longer explanation, tucked behind the info icon next to the title. */
  info?: string
  icon?: React.ReactNode
  /** Right-aligned controls in the title row (toggles, readouts). */
  actions?: React.ReactNode
  /** Left-aligned controls below the heading, for wider choice sets. */
  controls?: React.ReactNode
  children: React.ReactNode
  style?: React.CSSProperties
}

/**
 * The standard frame for every chart in the app: title row with an optional
 * icon, info tip and controls, a short always-on description, then the plot.
 * Using one component keeps spacing and typography identical across pages.
 */
export default function ChartCard({ title, description, info, icon, actions, controls, children, style }: ChartCardProps) {
  return (
    <div className="card chart-card" style={style}>
      <div className="chart-card-head">
        {icon && <span style={{ display: 'inline-flex', flexShrink: 0 }}>{icon}</span>}
        <h3 className="chart-card-title">{title}</h3>
        {info && <InfoTip text={info} label={title} />}
        {actions && <div className="chart-card-actions">{actions}</div>}
      </div>
      {description && <p className="chart-card-desc">{description}</p>}
      {controls && <div className="chart-card-controls">{controls}</div>}
      {children}
    </div>
  )
}

/** Placeholder shown in a chart's slot when there is nothing to plot. */
export function EmptyPlot({ height, children }: { height: number; children: React.ReactNode }) {
  return (
    <div style={{
      height, display: 'grid', placeItems: 'center', textAlign: 'center',
      fontSize: 12, color: 'var(--text-3)', padding: '0 16px',
    }}>
      {children}
    </div>
  )
}
