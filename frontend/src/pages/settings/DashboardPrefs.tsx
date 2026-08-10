import { useLocalStorage } from '../../lib/useLocalStorage'
import {
  DASHBOARD_CFG_KEY, DEFAULT_DASHBOARD_CONFIG, STAT_CARDS, WINDOW_OPTIONS,
  type DashboardConfig, type StatCardId,
} from '../../lib/dashboardConfig'
import SettingsCard from '../../components/SettingsCard'
import Field from '../../components/Field'
import Dropdown from '../../components/Dropdown'

/** Which dashboard cards show, and over what period. */
export default function DashboardSettings() {
  const [cfg, setCfg] = useLocalStorage<DashboardConfig>(DASHBOARD_CFG_KEY, DEFAULT_DASHBOARD_CONFIG)

  function toggleCard(id: StatCardId) {
    setCfg(prev => {
      const want = new Set(prev.cards)
      if (want.has(id)) want.delete(id)
      else want.add(id)
      // Keep the master order so cards render consistently.
      return { ...prev, cards: STAT_CARDS.map(c => c.id).filter(c => want.has(c)) }
    })
  }

  return (
    <>
      <SettingsCard title="Stat cards">
        <Field label="Shown on the dashboard">
          <div className="chip-row">
            {STAT_CARDS.map(c => {
              const on = cfg.cards.includes(c.id)
              return (
                <button
                  key={c.id}
                  className={`chip${on ? ' active' : ''}`}
                  aria-pressed={on}
                  onClick={() => toggleCard(c.id)}
                >
                  {c.label}
                </button>
              )
            })}
          </div>
        </Field>
      </SettingsCard>

      <SettingsCard title="Period">
        <Field
          label="Time window"
          info="Totals and the activity mix are calculated over this window."
        >
          <div style={{ maxWidth: 240 }}>
            <Dropdown
              block
              value={cfg.windowDays}
              options={WINDOW_OPTIONS}
              onChange={v => setCfg(prev => ({ ...prev, windowDays: v }))}
              ariaLabel="Time window"
            />
          </div>
        </Field>

        <label className="switch">
          <input
            type="checkbox"
            checked={cfg.showDeltas !== false}
            onChange={e => setCfg(prev => ({ ...prev, showDeltas: e.target.checked }))}
          />
          <span className="switch-track" />
          Compare against the previous period
        </label>
        <span className="field-hint">
          Measured against the equally long period just before your window, so it is unavailable
          when the window is All time.
        </span>

        <label className="switch">
          <input
            type="checkbox"
            checked={cfg.showSparklines !== false}
            onChange={e => setCfg(prev => ({ ...prev, showSparklines: e.target.checked }))}
          />
          <span className="switch-track" />
          Show trend sparklines
        </label>

      </SettingsCard>
    </>
  )
}
