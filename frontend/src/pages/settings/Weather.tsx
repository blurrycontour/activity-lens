import { useCallback, useEffect, useState } from 'react'
import { CalendarClock, CloudOff, CloudSun, Hourglass, Pencil, TriangleAlert } from 'lucide-react'
import SettingsCard from '../../components/SettingsCard'
import ConfirmDialog from '../../components/ConfirmDialog'
import { usePreferences } from '../../context/PreferencesContext'
import { type WeatherCounts } from '../../data/workouts'
import { api } from '../../lib/api'

/**
 * Whether to look up the conditions each workout happened in.
 *
 * Three separate decisions live here, and keeping them separate is the point:
 *
 *   the switch    covers workouts imported from now on
 *   the backfill  sends a coarse location and a timestamp for every run
 *                 already in the library
 *   the retry     re-opens lookups that ran out of attempts
 *
 * The switch is on by default precisely because it is the narrow one. The other
 * two are never implied by it — turning a setting on should not silently mean
 * "and send my last five years of movements somewhere" — so each is an action
 * with its own count, and the backfill has its own confirmation.
 *
 * The coverage figures are what make those actions decidable. "Fetch weather for
 * earlier workouts" is a leap of faith; "312 have conditions, 88 have never been
 * checked" is a choice.
 */

/** What each state means, said the way a person would ask about it. */
const ROWS: {
  key: keyof WeatherCounts
  label: string
  icon: React.ReactNode
  hint: string
}[] = [
  {
    key: 'scheduled', label: 'Scheduled',
    icon: <Hourglass size={15} />,
    hint: 'Queued for the next pass. If the weather service is busy this can take longer.',
  },
  {
    key: 'failed', label: "Couldn't be looked up",
    icon: <TriangleAlert size={15} />,
    hint: 'The service could not be reached enough times to give up on them.',
  },
  {
    key: 'unchecked', label: 'Never checked',
    icon: <CalendarClock size={15} />,
    hint: 'Imported before this feature existed. Only ever looked up if you ask.',
  },
  {
    key: 'recorded', label: 'With conditions',
    icon: <CloudSun size={15} />,
    hint: 'Looked up, or entered by hand.',
  },
  {
    key: 'skipped', label: 'No location',
    icon: <CloudOff size={15} />,
    hint: 'Indoor sessions and files recorded without GPS. Nothing about these is ever sent.',
  },
]

export default function WeatherSettings() {
  const { prefs, save } = usePreferences()
  // Undefined on a server too old to send the field, which is the same as on.
  const enabled = prefs?.weatherEnabled !== false

  const [counts, setCounts] = useState<WeatherCounts | null>(null)
  const [asking, setAsking] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState<'backfill' | 'retry' | null>(null)

  const refresh = useCallback(async () => {
    try {
      setCounts(await api.weatherStatus())
    } catch {
      // The card simply does not appear. A settings page that cannot save is
      // worth an error; one that cannot count is not.
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  async function toggle(on: boolean) {
    setMsg(null)
    try {
      await save({ weatherEnabled: on })
      // Asked here rather than assumed. Someone switching this on may well want
      // their history filled in — but that is the wider decision, and this is
      // the moment they are thinking about it.
      if (on && (counts?.unchecked ?? 0) > 0) setAsking(true)
    } catch {
      setMsg('Could not save that. Try again.')
    }
  }

  async function run(kind: 'backfill' | 'retry') {
    setAsking(false)
    setBusy(kind)
    setMsg(null)
    try {
      const { queued } = kind === 'backfill'
        ? await api.requestWeatherBackfill()
        : await api.retryFailedWeather()
      setMsg(queued > 0
        ? `${queued} workout${queued === 1 ? '' : 's'} queued. They fill in gradually over the next few hours.`
        : 'Nothing left to look up.')
      // Re-read rather than adjusting the numbers here: the server decides what
      // actually moved, and two places computing that is how they drift apart.
      await refresh()
    } catch {
      setMsg('Could not queue those workouts. Try again.')
    } finally {
      setBusy(null)
    }
  }

  const total = counts
    ? counts.recorded + counts.scheduled + counts.failed + counts.unchecked + counts.skipped
    : 0

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
          and still appear on the workout and in Analysis.
        </span>
      </SettingsCard>

      {/* Shown whenever there is a library to describe, including when every
          number is zero — "none of your workouts have conditions yet" is an
          answer, and a card that vanishes leaves the question open. */}
      {counts && total > 0 && (
        <SettingsCard title="Your workouts">
          <div className="weather-tally">
            {ROWS.map(row => (
              <div className="weather-tally-row" key={row.key} title={row.hint}>
                <span className="weather-tally-icon">{row.icon}</span>
                <span className="weather-tally-count">{counts[row.key]}</span>
                <span className="weather-tally-label">{row.label}</span>
              </div>
            ))}
          </div>

          {counts.manual > 0 && (
            <span className="field-hint" style={{ marginTop: 10 }}>
              <Pencil size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
              {counts.manual} {counts.manual === 1 ? 'was' : 'were'} entered by hand.
              A lookup never overwrites those.
            </span>
          )}

          {/* One button per thing that is actually actionable, each named with
              its number. A disabled "Fetch" over a zero would be furniture. */}
          <div className="weather-actions">
            {counts.unchecked > 0 && (
              <button
                className="btn btn-primary"
                disabled={busy !== null}
                onClick={() => setAsking(true)}
              >
                {busy === 'backfill' ? 'Queueing…' : `Fetch for ${counts.unchecked} never checked`}
              </button>
            )}
            {counts.failed > 0 && (
              <button
                className="btn btn-ghost"
                disabled={busy !== null}
                onClick={() => void run('retry')}
              >
                {busy === 'retry' ? 'Queueing…' : `Retry ${counts.failed} that failed`}
              </button>
            )}
          </div>

          {msg && <p className="field-hint" style={{ marginTop: 10 }}>{msg}</p>}
        </SettingsCard>
      )}

      <SettingsCard title="About this data">
        <span className="field-hint">
          Conditions come from a reanalysis model on roughly a 25 km grid, so
          they describe the area you were in rather than the exact road. A
          coastal or valley route can be a couple of degrees out.
        </span>
        <span className="field-hint">
          Each workout gets the average across the hours it spanned — not just
          the hour it started — with rainfall totalled and the condition taken at
          its worst. You can correct any of it by hand from the workout page.
        </span>
      </SettingsCard>

      {asking && (
        <ConfirmDialog
          title="Fetch weather for earlier workouts?"
          message={
            `This sends the start location and time of ${counts?.unchecked ?? 0} earlier ` +
            'workout(s) to Open-Meteo. They are looked up gradually in the ' +
            'background, so it may take a few hours to finish. New workouts are ' +
            'unaffected either way.'
          }
          confirmLabel="Fetch them"
          onConfirm={() => void run('backfill')}
          onCancel={() => setAsking(false)}
        />
      )}
    </>
  )
}
