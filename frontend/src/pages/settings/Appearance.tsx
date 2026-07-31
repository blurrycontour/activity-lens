import { Check } from 'lucide-react'
import { ACCENTS, applyAccent } from '../../lib/theme'
import { useLocalStorage } from '../../lib/useLocalStorage'
import { DEFAULT_HR_ZONE_CHART, HR_ZONE_CHART_KEY, type HRZoneChart } from '../../lib/dashboardConfig'
import SettingsCard from '../../components/SettingsCard'
import Field from '../../components/Field'

interface AppearanceProps {
  accent: string
  onAccentChange: (a: string) => void
}

/** Accent colour, chart style and units. */
export default function AppearanceSettings({ accent, onAccentChange }: AppearanceProps) {
  const [hrZoneChart, setHrZoneChart] = useLocalStorage<HRZoneChart>(HR_ZONE_CHART_KEY, DEFAULT_HR_ZONE_CHART)

  function pick(value: string) {
    onAccentChange(value)
    applyAccent(value)
  }

  return (
    <>
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
