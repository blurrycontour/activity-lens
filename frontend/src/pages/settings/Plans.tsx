import { useState } from 'react'
import Dropdown from '../../components/Dropdown'
import SettingsCard from '../../components/SettingsCard'
import { usePreferences } from '../../context/PreferencesContext'
import {
  buzz as playBuzz, buzzEnabled, canBuzz, canSound, LONG_TIMER_CHOICES, longTimerSec, primeSound,
  setBuzzEnabled, setLongTimerSec, setSoundEnabled, sound as playSound, soundEnabled,
} from '../../lib/sessionFeedback'

/** "15 seconds", "1 minute", "3 minutes" — one phrasing for the whole list. */
function thresholdLabel(sec: number): string {
  if (sec < 60) return `${sec} seconds`
  return sec === 60 ? '1 minute' : `${sec / 60} minutes`
}

/**
 * Settings for training plans: what a finished session becomes, and how a
 * running one announces itself.
 *
 * Recording sessions as workouts is off by default. The rest of the library is
 * measured by a device; folding hand-entered gym work into the same totals
 * changes what a streak or a yearly total means, so it is a decision rather
 * than a default.
 */
export default function PlansSettings() {
  const { prefs, save } = usePreferences()
  const [msg, setMsg] = useState<string | null>(null)
  // Read once into state rather than on every render: these live in
  // localStorage, and the switches have to move when tapped.
  const [buzz, setBuzz] = useState(buzzEnabled)
  const [sound, setSound] = useState(soundEnabled)
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
        Counts towards your streak, goals and totals. Sessions stay in the
        plan's history either way.
      </span>
      {msg && <span className="status-msg err">{msg}</span>}
    </SettingsCard>

    {/* One card, because they are one thing: a session announcing itself.
        Both switches cover every moment — a set, a finished exercise, a rest
        ending, the session starting and ending — so neither is a special case
        of the other, and only devices that can actually do it are offered it. */}
    {(canBuzz() || canSound()) && (
      <SettingsCard title="Signals">
        {canBuzz() && (
          <label className="switch" style={{ fontSize: 13, color: 'var(--text)' }}>
            <input
              type="checkbox"
              checked={buzz}
              onChange={e => {
                setBuzz(e.target.checked)
                setBuzzEnabled(e.target.checked)
                // Buzzed from inside the tap that turned it on, the way the
                // sound switch plays its note: it is the only way to find out
                // whether this phone actually does it, and a switch you cannot
                // test is a switch you have to take on faith.
                if (e.target.checked) playBuzz('exercise')
              }}
            />
            <span className="switch-track" />
            Vibrate
          </label>
        )}
        {canSound() && (
          <label className="switch" style={{ fontSize: 13, color: 'var(--text)' }}>
            <input
              type="checkbox"
              checked={sound}
              onChange={e => {
                setSound(e.target.checked)
                setSoundEnabled(e.target.checked)
                // Played from inside the tap that turned it on: the only way to
                // hear what you just agreed to, and the only moment a browser
                // will let it make a sound.
                // The sound alone, not the buzz beside it: this switch is
                // about one of the two, and answering a tap on it with both
                // says the wrong thing about what was just turned on.
                if (e.target.checked) { primeSound(); playSound('exercise') }
              }}
            />
            <span className="switch-track" />
            Play a sound
          </label>
        )}
        <span className="field-hint">
          For a set ticked, an exercise finished, a rest ending, and a session
          starting or ending — the moments your hands are busy. Kept on this
          device.
        </span>

        <div className="field" style={{ marginTop: 4 }}>
          <span className="field-label">Announce a rest from</span>
          <Dropdown
            block
            value={longSec}
            options={LONG_TIMER_CHOICES.map(sec => ({ value: sec, label: thresholdLabel(sec) }))}
            onChange={v => { setLongSec(v); setLongTimerSec(v) }}
            active={longSec !== 60}
            ariaLabel="Announce a rest from"
          />
          <span className="field-hint">
            Shorter rests pass in silence — you spend those watching the clock.
          </span>
        </div>
      </SettingsCard>
    )}
    </>
  )
}
