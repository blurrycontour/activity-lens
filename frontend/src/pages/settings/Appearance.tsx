import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { ACCENTS, applyAccent } from '../../lib/theme'
import { useLocalStorage } from '../../lib/useLocalStorage'
import { DEFAULT_HR_ZONE_CHART, HR_ZONE_CHART_KEY, type HRZoneChart } from '../../lib/dashboardConfig'
import SettingsCard from '../../components/SettingsCard'
import Field from '../../components/Field'

import type { ThemeMode } from '../../components/TopBar'

interface AppearanceProps {
  accent: string
  onAccentChange: (a: string) => void
  themeMode: ThemeMode
  onThemeChange: (m: ThemeMode) => void
}

/**
 * The three themes, named rather than cycled.
 *
 * The top bar's button cycles dark → light → system, which is quick once you
 * know the order and opaque until then — there is no way to see what the
 * options are, or to go straight to one. Here they are laid out, which is what
 * a settings page is for.
 */
const THEMES: { id: ThemeMode; label: string; hint: string; icon: React.ReactNode }[] = [
  { id: 'dark', label: 'Dark', hint: 'Always dark', icon: <Moon size={16} /> },
  { id: 'light', label: 'Light', hint: 'Always light', icon: <Sun size={16} /> },
  { id: 'system', label: 'System', hint: 'Follows your device', icon: <Monitor size={16} /> },
]

/** Theme, accent colour and chart style. */
export default function AppearanceSettings({ accent, onAccentChange, themeMode, onThemeChange }: AppearanceProps) {
  const [hrZoneChart, setHrZoneChart] = useLocalStorage<HRZoneChart>(HR_ZONE_CHART_KEY, DEFAULT_HR_ZONE_CHART)

  function pick(value: string) {
    onAccentChange(value)
    applyAccent(value)
  }

  return (
    <>
      <SettingsCard title="Theme" description="Also on the top bar, which cycles through these in order.">
        <div className="theme-choices">
          {THEMES.map(t => {
            const on = themeMode === t.id
            return (
              <button
                key={t.id}
                className={`theme-choice${on ? ' active' : ''}`}
                aria-pressed={on}
                onClick={() => onThemeChange(t.id)}
              >
                {t.icon}
                <span className="theme-choice-label">{t.label}</span>
                <span className="theme-choice-hint">{t.hint}</span>
                {on && <Check size={13} className="theme-choice-tick" />}
              </button>
            )
          })}
        </div>
      </SettingsCard>

      <SettingsCard title="Accent colour" description="Used for highlights, active states and charts.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
          {ACCENTS.map(a => {
            const on = accent === a.value
            return (
              <button
                key={a.value}
                onClick={() => pick(a.value)}
                aria-pressed={on}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                  border: `1.5px solid ${on ? a.value : 'var(--border)'}`,
                  background: on ? a.dim : 'var(--bg-3)',
                  transition: 'all 0.15s',
                }}
              >
                <span style={{
                  width: 18, height: 18, borderRadius: '50%', background: a.value,
                  flexShrink: 0, boxShadow: on ? `0 0 8px ${a.glow}` : 'none',
                }} />
                <span style={{ fontSize: 12, fontWeight: 500, color: on ? a.value : 'var(--text-2)', flex: 1, textAlign: 'left' }}>
                  {a.name}
                </span>
                {on && <Check size={13} color={a.value} />}
              </button>
            )
          })}
        </div>
      </SettingsCard>

      <SettingsCard title="Charts">
        <Field
          label="Heart-rate zones"
          info="The histogram makes zones easier to compare; the donut emphasises each one's share of the whole."
        >
          <div className="chip-row">
            {([{ id: 'histogram', label: 'Histogram' }, { id: 'pie', label: 'Donut' }] as const).map(o => (
              <button
                key={o.id}
                className={`chip${hrZoneChart === o.id ? ' active' : ''}`}
                aria-pressed={hrZoneChart === o.id}
                onClick={() => setHrZoneChart(o.id)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </Field>
      </SettingsCard>
    </>
  )
}
