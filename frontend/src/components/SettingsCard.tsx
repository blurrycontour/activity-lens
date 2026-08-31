interface SettingsCardProps {
  title?: string
  icon?: React.ReactNode
  /** Short line under the title. Keep it to what the controls can't say. */
  description?: string
  /** Red border and title — destructive areas only. */
  danger?: boolean
  actions?: React.ReactNode
  /** Deep-link target for settings search; rendered as id="setting-<anchorId>". */
  anchorId?: string
  children: React.ReactNode
}

/**
 * A titled card inside a settings category page.
 *
 * Replaces eighteen hand-styled `<section className="card"><h3 style={…}>`
 * blocks that had drifted into three slightly different sizes and spacings.
 */
export default function SettingsCard({
  title, icon, description, danger, actions, anchorId, children,
}: SettingsCardProps) {
  return (
    <section className={`settings-card${danger ? ' danger' : ''}`} id={anchorId ? `setting-${anchorId}` : undefined}>
      {(title || description) && (
        <div className="settings-card-head">
          {title && (
            <h3 className="settings-card-title">
              {icon}
              <span style={{ flex: 1 }}>{title}</span>
              {actions}
            </h3>
          )}
          {description && <p className="settings-card-desc">{description}</p>}
        </div>
      )}
      {children}
    </section>
  )
}
