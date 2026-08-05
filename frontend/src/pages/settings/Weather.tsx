import { useEffect, useState } from 'react'
import SettingsCard from '../../components/SettingsCard'
import ConfirmDialog from '../../components/ConfirmDialog'
import { usePreferences } from '../../context/PreferencesContext'
import { api } from '../../lib/api'

/**
 * Whether to look up the conditions each workout happened in.
 *
 * Two separate decisions live here, and keeping them separate is the point:
 *
 *   the switch    covers workouts imported from now on
 *   the backfill  sends a coarse location and a timestamp for every run
 *                 already in the library
 *
 * The switch is on by default precisely because it is the narrow one. The
 * backfill is never implied by it — turning a setting on should not silently
 * mean "and send my last five years of movements somewhere", so it is an action
 * with its own confirmation and its own count.
 */
export default function WeatherSettings() {
  const { prefs, save } = usePreferences()
  // Undefined on a server too old to send the field, which is the same as on.
  const enabled = prefs?.weatherEnabled !== false

  const [backfillable, setBackfillable] = useState<number | null>(null)
  const [asking, setAsking] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    api.weatherBackfillStatus()
      .then(r => { if (alive) setBackfillable(r.pending) })
      .catch(() => { /* the offer simply does not appear */ })
    return () => { alive = false }
  }, [])

  async function toggle(on: boolean) {
    setMsg(null)
    try {
      await save({ weatherEnabled: on })
      // Asked here rather than assumed. Someone switching this on may well want
      // their history filled in — but that is the wider decision, and this is
      // the moment they are thinking about it.
      if (on && (backfillable ?? 0) > 0) setAsking(true)
    } catch {
      setMsg('Could not save that. Try again.')
    }
  }

  async function backfill() {
    setAsking(false)
    setBusy(true)
    setMsg(null)
    try {
      const { queued } = await api.requestWeatherBackfill()
      setBackfillable(0)
      setMsg(queued > 0
        ? `${queued} workout${queued === 1 ? '' : 's'} queued. They fill in gradually over the next few hours.`
        : 'Nothing left to look up.')
    } catch {
      setMsg('Could not queue those workouts. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SettingsCard title="Weather">
        <label className="switch" style={{ fontSize: 13, color: 'var(--text)' }}>
          <input
            type="checkbox"
            checked={enabled}
            disabled={!prefs}
            onChange={e => void toggle(e.target.checked)}
          />
          <span className="switch-track" />
          Look up conditions for new workouts
        </label>
        <span className="field-hint">
          Sends each new workout's start coordinates and time to{' '}
          <a href="https://open-meteo.com" target="_blank" rel="noreferrer">Open-Meteo</a>{' '}
          to find the temperature, humidity, wind and rain it happened in. Indoor
          workouts and files without GPS are never sent.
        </span>
        <span className="field-hint">
          Turning this off stops new lookups. Conditions already recorded stay,
          and still appear in Analysis.
        </span>
      </SettingsCard>

      {/* Only offered when there is something to offer, and always with the
          number — "we will check 300 workouts" is a decision someone can make,
          where a bare "backfill" button is not. */}
      {(backfillable ?? 0) > 0 && (
        <SettingsCard title="Earlier workouts">
          <span className="field-hint">
            {backfillable} workout{backfillable === 1 ? ' has' : 's have'} never been
            checked — everything imported before this feature existed. Looking them
            up sends their start coordinates and times to Open-Meteo too.
          </span>
          <button
            className="btn btn-primary"
            style={{ alignSelf: 'flex-start', marginTop: 4 }}
            disabled={busy}
            onClick={() => setAsking(true)}
          >
            {busy ? 'Queueing…' : 'Fetch weather for these'}
          </button>
        </SettingsCard>
      )}

      {msg && <p className="field-hint" style={{ marginTop: 12 }}>{msg}</p>}

      {asking && (
        <ConfirmDialog
          title="Fetch weather for earlier workouts?"
          message={
            `This sends the start location and time of ${backfillable ?? 0} earlier ` +
            'workout(s) to Open-Meteo. They are looked up gradually in the ' +
            'background, so it may take a few hours to finish. New workouts are ' +
            'unaffected either way.'
          }
          confirmLabel="Fetch them"
          onConfirm={() => void backfill()}
          onCancel={() => setAsking(false)}
        />
      )}
    </>
  )
}
