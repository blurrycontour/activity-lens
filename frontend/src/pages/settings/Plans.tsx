import { useState } from 'react'
import SettingsCard from '../../components/SettingsCard'
import { usePreferences } from '../../context/PreferencesContext'
import {
  canVibrate, hapticsEnabled, LONG_TIMER_CHOICES, longTimerSec, setHapticsEnabled,
  setLongTimerSec, setTimerHapticsEnabled, timerHapticsEnabled,
} from '../../lib/haptics'

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
  // Read once into state rather than on every render: these live in
  // localStorage, and the switches have to move when tapped.
  const [buzz, setBuzz] = useState(hapticsEnabled)
  const [buzzTimers, setBuzzTimers] = useState(timerHapticsEnabled)
  const [longSec, setLongSec] = useState(longTimerSec)

  async function toggle(on: boolean) {
    setMsg(null)
    try {
      await save({ planWorkouts: on })
    } catch {
      setMsg('Could not save that. Try again.')
    }
  }

  return (
    <>
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
        Adds a strength workout for the session, so it counts towards your
        streak, goals and totals. Sessions stay in the plan's history either
        way.
      </span>
      {msg && <span className="status-msg err">{msg}</span>}
    </SettingsCard>

    {/* Only where it can actually happen. A pair of switches on a laptop that
        promise a buzz no browser there can produce is worse than no switches:
        turning them on and feeling nothing reads as a bug. */}
    {canVibrate() && (
      <SettingsCard title="Vibration">
        <label className="switch" style={{ fontSize: 13, color: 'var(--text)' }}>
          <input
            type="checkbox"
            checked={buzz}
            onChange={e => { setBuzz(e.target.checked); setHapticsEnabled(e.target.checked) }}
          />
          <span className="switch-track" />
          Vibrate during a session
        </label>
        <span className="field-hint">
          A short buzz for a set, a longer one for a finished exercise, and for
          a session starting, ending or being discarded — for the moments your
          hands are busy and the phone is on the floor.
        </span>

        <label className="switch" style={{ fontSize: 13, color: 'var(--text)', marginTop: 14 }}>
          <input
            type="checkbox"
            checked={buzzTimers}
            disabled={!buzz}
            onChange={e => { setBuzzTimers(e.target.checked); setTimerHapticsEnabled(e.target.checked) }}
          />
          <span className="switch-track" />
          Vibrate when a long rest ends
        </label>
        <span className="field-hint">
          A short rest is spent watching the clock; a long one is spent doing
          something else, which is what this is for.
        </span>

        <label className="field" style={{ marginTop: 10 }}>
          <span className="field-label">Count a rest as long from</span>
          <select
            className="input"
            value={longSec}
            disabled={!buzz || !buzzTimers}
            onChange={e => { const n = Number(e.target.value); setLongSec(n); setLongTimerSec(n) }}
          >
            {LONG_TIMER_CHOICES.map(sec => (
              <option key={sec} value={sec}>
                {sec < 60 ? `${sec} seconds` : sec === 60 ? '1 minute' : `${sec / 60} minutes`}
              </option>
            ))}
          </select>
        </label>

        <span className="field-hint">
          Kept on this device: vibration is a property of the hardware in your
          hand, and no desktop browser has it at all.
        </span>
      </SettingsCard>
    )}
    </>
  )
}
