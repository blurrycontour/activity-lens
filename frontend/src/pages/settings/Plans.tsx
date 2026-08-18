import { useState } from 'react'
import SettingsCard from '../../components/SettingsCard'
import { usePreferences } from '../../context/PreferencesContext'
import {
  canVibrate, hapticsEnabled, LONG_TIMER_SEC, setHapticsEnabled,
  setTimerHapticsEnabled, timerHapticsEnabled,
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
          A short buzz when a set is ticked, a longer one when an exercise or
          the whole session is done, and when a session starts or is discarded.
          During a set your hands are busy and the phone is on the floor, which
          is the one moment the screen cannot tell you anything.
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
          Only for rests longer than {LONG_TIMER_SEC} seconds. A short rest is
          spent standing over the bar watching the clock; past a minute you
          have put the phone down and started doing something else, which is
          the case this is for.
        </span>

        <span className="field-hint">
          Kept on this device rather than on your account: vibration is a
          property of the hardware in your hand, and no desktop browser has it
          at all.
        </span>
      </SettingsCard>
    )}
    </>
  )
}
