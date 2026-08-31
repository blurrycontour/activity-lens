import { useEffect, useState } from 'react'
import { usePreferences } from '../../context/PreferencesContext'
import { ApiError } from '../../lib/api'
import SettingsCard from '../../components/SettingsCard'
import Field from '../../components/Field'
import StatusMsg, { type Msg } from '../../components/StatusMsg'
import Dropdown, { type DropdownOption } from '../../components/Dropdown'

type Sex = 'male' | 'female' | ''
type CalorieMethod = 'heart-rate' | 'distance'
type HRZoneMethod = 'max' | 'reserve'

const SEX_OPTIONS: DropdownOption<Sex>[] = [
  { value: '', label: 'Prefer not to say' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
]

const CALORIE_OPTIONS: DropdownOption<CalorieMethod>[] = [
  { value: 'heart-rate', label: 'Heart rate, then distance' },
  { value: 'distance', label: 'Distance only' },
]

const HR_ZONE_OPTIONS: DropdownOption<HRZoneMethod>[] = [
  { value: 'max', label: '% of max heart rate' },
  { value: 'reserve', label: 'Heart-rate reserve (Karvonen)' },
]

/**
 * Body metrics and performance thresholds.
 *
 * Kept on one page because they answer one question — what the app should
 * assume about you when a workout does not say. Splitting them further would
 * mean three pages of two fields each.
 */
export default function BodySettings() {
  const { prefs, save } = usePreferences()

  const [sex, setSex] = useState<Sex>('')
  const [birthYear, setBirthYear] = useState('')
  const [heightCm, setHeightCm] = useState('')
  const [stepLengthCm, setStepLengthCm] = useState('')
  const [bodyWeightKg, setBodyWeightKg] = useState('70')
  const [calorieMethod, setCalorieMethod] = useState<CalorieMethod>('heart-rate')
  const [maxHr, setMaxHr] = useState('')
  const [restingHr, setRestingHr] = useState('')
  const [hrZoneMethod, setHrZoneMethod] = useState<HRZoneMethod>('max')
  const [thresholdPace, setThresholdPace] = useState('')
  const [ftp, setFtp] = useState('')

  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg | null>(null)

  // Seed the inputs once the record arrives. Inputs stay strings so a
  // half-typed number is not coerced to 0 under the user's cursor.
  useEffect(() => {
    if (!prefs) return
    setSex(prefs.sex ?? '')
    setBirthYear(prefs.birthYear ? String(prefs.birthYear) : '')
    setHeightCm(prefs.heightCm ? String(prefs.heightCm) : '')
    setStepLengthCm(prefs.stepLengthCm ? String(prefs.stepLengthCm) : '')
    setBodyWeightKg(String(prefs.bodyWeightKg ?? 70))
    setCalorieMethod(prefs.calorieMethod)
    setMaxHr(prefs.maxHr ? String(prefs.maxHr) : '')
    setRestingHr(prefs.restingHr ? String(prefs.restingHr) : '')
    setHrZoneMethod(prefs.hrZoneMethod ?? 'max')
    setThresholdPace(prefs.thresholdPace ?? '')
    setFtp(prefs.ftp ? String(prefs.ftp) : '')
  }, [prefs])

  async function onSave() {
    setBusy(true); setMsg(null)
    try {
      await save({
        sex,
        birthYear: Number(birthYear) || 0,
        heightCm: Number(heightCm) || 0,
        stepLengthCm: Number(stepLengthCm) || 0,
        bodyWeightKg: Number(bodyWeightKg) || 70,
        calorieMethod,
        maxHr: Number(maxHr) || 0,
        restingHr: Number(restingHr) || 0,
        hrZoneMethod,
        thresholdPace,
        ftp: Number(ftp) || 0,
      })
      setMsg({ ok: true, text: 'Saved' })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Save failed' })
    } finally { setBusy(false) }
  }

  const units = [
    { label: 'Max HR', value: maxHr, set: setMaxHr, unit: 'bpm', type: 'number', placeholder: '185',
      info: 'Used to compute heart-rate zones for workouts that do not report their own.' },
    { label: 'Resting HR', value: restingHr, set: setRestingHr, unit: 'bpm', type: 'number', placeholder: '52' },
    { label: 'Threshold pace', value: thresholdPace, set: setThresholdPace, unit: '/km', type: 'text', placeholder: '5:00' },
    { label: 'FTP', value: ftp, set: setFtp, unit: 'W', type: 'number', placeholder: '240',
      info: 'Functional threshold power — the cycling equivalent of threshold pace.' },
  ] as const

  return (
    <>
      <SettingsCard title="About you" description="Private to your account. Used to personalise estimates.">
        <div className="field-grid">
          <Field label="Sex">
            <Dropdown
              block
              value={sex}
              options={SEX_OPTIONS}
              onChange={setSex}
              ariaLabel="Sex"
            />
          </Field>
          <Field label="Birth year">
            <input className="input" type="number" min="1900" max={new Date().getFullYear()} placeholder="1990" style={{ width: '100%' }} value={birthYear} onChange={e => setBirthYear(e.target.value)} />
          </Field>
          <Field label="Height">
            <div className="input-unit">
              <input className="input" type="number" min="100" max="250" placeholder="175" value={heightCm} onChange={e => setHeightCm(e.target.value)} />
              <span>cm</span>
            </div>
          </Field>
          <Field label="Body weight">
            <div className="input-unit">
              <input className="input" type="number" min="25" max="300" placeholder="70" value={bodyWeightKg} onChange={e => setBodyWeightKg(e.target.value)} />
              <span>kg</span>
            </div>
          </Field>
          <Field label="Step length" info="Used to estimate step counts from distance on runs and hikes.">
            <div className="input-unit">
              <input className="input" type="number" min="30" max="200" placeholder="75" value={stepLengthCm} onChange={e => setStepLengthCm(e.target.value)} />
              <span>cm</span>
            </div>
          </Field>
        </div>
      </SettingsCard>

      <SettingsCard title="Calorie estimation">
        <Field
          label="Method"
          info="Only used when an imported workout does not already report calories. The heart-rate method draws on your sex, age and weight above."
        >
          <div style={{ maxWidth: 260 }}>
            <Dropdown
              block
              value={calorieMethod}
              options={CALORIE_OPTIONS}
              onChange={setCalorieMethod}
              ariaLabel="Calorie method"
            />
          </div>
        </Field>
      </SettingsCard>

      <SettingsCard title="Performance thresholds">
        <div className="field-grid">
          <Field label="HR zone model" info="Max HR uses a percentage of your maximum. Karvonen uses your resting HR too. Each workout's zones chart shows a badge naming the model used.">
            <Dropdown
              block
              value={hrZoneMethod}
              options={HR_ZONE_OPTIONS}
              onChange={setHrZoneMethod}
              ariaLabel="Heart-rate zone model"
            />
          </Field>
          {units.map(f => (
            <Field key={f.label} label={f.label} info={'info' in f ? f.info : undefined}>
              <div className="input-unit">
                <input
                  className="input"
                  type={f.type}
                  value={f.value}
                  placeholder={f.placeholder}
                  onChange={e => f.set(e.target.value)}
                />
                <span>{f.unit}</span>
              </div>
            </Field>
          ))}
        </div>
      </SettingsCard>

      <div className="settings-actions">
        <button className="btn btn-primary" onClick={onSave} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <StatusMsg msg={msg} />
      </div>
    </>
  )
}
