import { useState } from 'react'
import {
  CloudOff, CloudRain, CloudSun, Droplets, RotateCcw,
  Thermometer, ThermometerSun, Wind,
} from 'lucide-react'
import { type Weather, type Workout } from '../data/workouts'
import { WEATHER_FIELDS, WEATHER_ROWS, type WeatherKey, formatWeatherValue, weatherLabel } from '../lib/weather'
import InfoTip from './InfoTip'
import Dropdown from './Dropdown'
import { api } from '../lib/api'

/**
 * The conditions a workout happened in.
 *
 * Renders in every state rather than only when there is a reading, because
 * "nothing here" and "we could not find out" and "you have this switched off"
 * are three different answers and only one of them is the user's to act on.
 * The panel disappearing entirely was the earlier design, and it left someone
 * who had turned weather off with no hint that the feature existed.
 *
 * The one thing it never does is show a number it does not have. Every column
 * behind this is stored NOT NULL DEFAULT 0, so an unfetched workout would
 * otherwise render a confident 0 °C on a clear, still day.
 */

interface WeatherCardProps {
  workout: Workout
  /** False for someone else's workout: no editing, and no settings hints. */
  isOwner: boolean
  /** Whether this user has lookups switched on, for the "it's off" message. */
  enabled: boolean
  onSaved: (w: Workout) => void
  /** Sends the user to where the setting lives. */
  onOpenSettings: () => void
}

export default function WeatherCard({ workout, isOwner, enabled, onSaved, onOpenSettings }: WeatherCardProps) {
  const [editing, setEditing] = useState(false)
  const w = workout.weather

  // A viewer looking at someone else's workout gets the reading or nothing at
  // all — the status describes the owner's settings and their server, which is
  // not something to explain to a stranger.
  if (!isOwner) {
    if (!w) return null
    return (
      <div className="card weather-card">
        <WeatherReading weather={w} />
      </div>
    )
  }

  if (editing) {
    return (
      <WeatherEditor
        workout={workout}
        onCancel={() => setEditing(false)}
        onSaved={next => { setEditing(false); onSaved(next) }}
      />
    )
  }

  return (
    <div className="card weather-card">
      <div className="weather-card-head">
        <h3 className="weather-card-title">
          {w ? <CloudSun size={14} /> : <CloudOff size={14} />}
          Conditions
        </h3>
        <div style={{ display: 'flex', gap: 4 }}>
          {workout.weatherStatus === 'manual' && (
            <button
              className="btn-icon"
              title="Remove your entry and look it up again"
              aria-label="Reset weather"
              onClick={() => { void api.clearWorkoutWeather(workout.id).then(onSaved) }}
            >
              <RotateCcw size={14} />
            </button>
          )}
          {/* Words, like the notes and equipment cards beside it. A bare
              pencil here was the one card on the page whose heading opened
              with an icon, which read as a different kind of control rather
              than as the same one drawn smaller. */}
          <button
            className="btn btn-ghost btn-section"
            title={w ? 'Edit these conditions' : 'Enter conditions by hand'}
            onClick={() => setEditing(true)}
          >
            {w ? 'Edit' : 'Add'}
          </button>
        </div>
      </div>
      {w
        ? <WeatherReading weather={w} manual={workout.weatherStatus === 'manual'} />
        : <WeatherAbsence status={workout.weatherStatus} enabled={enabled} onOpenSettings={onOpenSettings} />}
    </div>
  )
}

/**
 * An icon per field, kept here rather than in `lib/weather` so the list stays
 * plain data that a test can read without pulling in React.
 */
const FIELD_ICONS: Record<WeatherKey, typeof Thermometer> = {
  tempC: Thermometer,
  apparentC: ThermometerSun,
  humidity: Droplets,
  windKph: Wind,
  precipMm: CloudRain,
}

function WeatherReading({ weather, manual }: { weather: Weather; manual?: boolean }) {
  return (
    <>
      <div className="weather-sub" style={{ marginTop: 0 }}>
        {weatherLabel(weather.code)}
        {/* Said plainly, because it changes what the number means: this one was
            not measured by the model, and will not be replaced by it. */}
        {manual && ' · entered by hand'}
      </div>
      {/* Every field, every time, in two fixed rows: the temperatures are the
          pair a reader compares, and one flowing row separated them at whatever
          width it happened to run out of. The icon is what makes five values
          scannable; each is also its own tooltip, because none of these numbers
          means quite what it looks like — see the hints in weather.ts. */}
      <div className="weather-metrics">
        {WEATHER_ROWS.map((row, i) => (
          <div className="weather-metric-row" key={i}>
            {row.map(key => {
              const f = WEATHER_FIELDS.find(x => x.key === key)
              if (!f) return null
              const Icon = FIELD_ICONS[f.key]
              return (
                <InfoTip key={f.key} label={f.label} text={f.hint} className="weather-metric">
                  <Icon size={14} aria-hidden />
                  <span className="weather-metric-value">
                    <span className="sr-only">{f.label}: </span>
                    {formatWeatherValue(f, weather)}
                  </span>
                </InfoTip>
              )
            })}
          </div>
        ))}
      </div>
    </>
  )
}

/**
 * What to say when there is no reading.
 *
 * Each of these is a different situation with a different remedy, and a single
 * "no weather data" would hide all of it — most damagingly the case where the
 * user simply has the setting off and is one click from fixing it.
 */
function WeatherAbsence({ status, enabled, onOpenSettings }: {
  status?: string
  enabled: boolean
  onOpenSettings: () => void
}) {
  if (!enabled) {
    return (
      <p className="weather-absent">
        Weather lookups are turned off.{' '}
        <button className="link-button" onClick={onOpenSettings}>Turn them on in Settings</button>
        {' '}or add the conditions yourself.
      </p>
    )
  }
  switch (status) {
    case 'skipped':
      return (
        <p className="weather-absent">
          This workout has no location to look up — an indoor session, or a file
          recorded without GPS. You can still add the conditions yourself.
        </p>
      )
    case 'failed':
      return (
        <p className="weather-absent">
          We could not reach the weather service for this workout. It will not be
          retried; add the conditions yourself if you want them.
        </p>
      )
    case 'none':
      return (
        <p className="weather-absent">
          This workout was imported before weather lookups existed.{' '}
          <button className="link-button" onClick={onOpenSettings}>
            Fetch weather for earlier workouts
          </button>
          {' '}in Settings, or add it yourself.
        </p>
      )
    default:
      // 'pending', and also where a throttled workout sits: when Open-Meteo is
      // rate limiting us the row is deliberately left untouched, so it stays
      // queued rather than being recorded as a failure that was never about
      // this workout. "Scheduled" is true in both cases.
      return (
        <p className="weather-absent">
          Scheduled — conditions will be filled in automatically. If the weather
          service is busy this can take a little longer.
        </p>
      )
  }
}

/** WMO codes offered as a short list, since nobody knows the numbers. */
const CONDITIONS = [
  { code: 0, label: 'Clear' },
  { code: 2, label: 'Partly cloudy' },
  { code: 3, label: 'Overcast' },
  { code: 45, label: 'Fog' },
  { code: 51, label: 'Drizzle' },
  { code: 61, label: 'Rain' },
  { code: 71, label: 'Snow' },
  { code: 80, label: 'Showers' },
  { code: 95, label: 'Thunderstorm' },
]

function WeatherEditor({ workout, onCancel, onSaved }: {
  workout: Workout
  onCancel: () => void
  onSaved: (w: Workout) => void
}) {
  const existing = workout.weather
  const [values, setValues] = useState<Weather>(existing ?? {
    tempC: 15, apparentC: 15, humidity: 60, windKph: 5, precipMm: 0, code: 0,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      onSaved(await api.setWorkoutWeather(workout.id, values))
    } catch (err) {
      // The server range-checks these, and its message names the field.
      setError(err instanceof Error ? err.message : 'Could not save these conditions.')
      setBusy(false)
    }
  }

  return (
    <div className="card weather-card">
      <h3 className="weather-card-title" style={{ marginBottom: 4 }}>
        <CloudSun size={14} /> Conditions
      </h3>
      <p className="weather-editor-note">
        What you enter here replaces the looked-up values and will not be
        overwritten later.
      </p>

      <div className="weather-editor-grid">
        {WEATHER_FIELDS.map(f => (
          <label key={f.key} className="weather-field">
            <span className="weather-field-label">{f.label}</span>
            <span className="weather-field-input">
              <input
                className="input"
                type="number"
                step={f.step}
                value={values[f.key]}
                onChange={e => setValues(v => ({ ...v, [f.key]: Number(e.target.value) }))}
              />
              <span className="weather-field-unit">{f.unit}</span>
            </span>
          </label>
        ))}
        <div className="weather-field">
          <span className="weather-field-label">Conditions</span>
          {/* The app's dropdown, not a native select: a bare <select> is styled
              by the OS and ignores the accent and light mode entirely. */}
          <Dropdown
            block
            ariaLabel="Conditions"
            value={values.code}
            options={CONDITIONS.map(c => ({ value: c.code, label: c.label }))}
            onChange={code => setValues(v => ({ ...v, code }))}
          />
        </div>
      </div>

      {error && <p className="weather-error">{error}</p>}

      <div className="weather-editor-actions">
        <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
