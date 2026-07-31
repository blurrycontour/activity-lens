import { ChevronRight } from 'lucide-react'

interface SettingsRowProps {
  icon: React.ReactNode
  label: string
  /** One line saying what is inside; truncated rather than wrapped. */
  sub?: string
  onClick: () => void
}

/** One tappable category in a settings hub. */
export default function SettingsRow({ icon, label, sub, onClick }: SettingsRowProps) {
  return (
    <button className="settings-row" onClick={onClick}>
      <span className="settings-row-icon">{icon}</span>
      <span className="settings-row-body">
        <span className="settings-row-label" style={{ display: 'block' }}>{label}</span>
        {sub && <span className="settings-row-sub" style={{ display: 'block' }}>{sub}</span>}
      </span>
      <ChevronRight size={16} className="settings-row-chevron" />
    </button>
  )
}
