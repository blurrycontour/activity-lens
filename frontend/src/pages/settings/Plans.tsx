import { useState } from 'react'
import SettingsCard from '../../components/SettingsCard'
import { usePreferences } from '../../context/PreferencesContext'

/**
 * What happens to a training session once it is finished.
 *
 * One switch, off by default. The rest of the library is measured by a device;
 * folding hand-entered gym work into the same totals changes what a streak or
 * a yearly total means, so it is a decision rather than a default.
 */
export default function PlansSettings() {
  const { prefs, save } = usePreferences()
  const [msg, setMsg] = useState<string | null>(null)

  async function toggle(on: boolean) {
    setMsg(null)
    try {
      await save({ planWorkouts: on })
    } catch {
      setMsg('Could not save that. Try again.')
    }
  }

  return (
    <SettingsCard title="Finished sessions">
      <label className="switch" style={{ fontSize: 13, color: 'var(--text)' }}>
        <input
          type="checkbox"
          checked={!!prefs?.planWorkouts}
          disabled={!prefs}
          onChange={e => void toggle(e.target.checked)}
        />
        <span className="switch-track" />
        Record each finished session as a workout
      </label>
      <span className="field-hint">
        Adds a strength workout named after the plan and the day, lasting from
        when you started the session to when you finished it. It then counts
        towards your streak, your goals and your totals like any other workout.
      </span>
      <span className="field-hint">
        Off by default because everything else in your library was measured by a
        device. Sessions are always kept in the plan's own history either way —
        this only decides whether they also appear under Workouts.
      </span>
      {msg && <span className="status-msg err">{msg}</span>}
    </SettingsCard>
  )
}
