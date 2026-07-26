import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { ACCENTS, applyAccent } from '../lib/theme'
import { api, ApiError } from '../lib/api'
import { useLocalStorage } from '../lib/useLocalStorage'
import {
  DASHBOARD_CFG_KEY, DEFAULT_DASHBOARD_CONFIG, STAT_CARDS, WINDOW_OPTIONS,
  type DashboardConfig, type StatCardId,
} from '../lib/dashboardConfig'

interface SettingsProps {
  accent: string
  onAccentChange: (a: string) => void
}

export default function Settings({ accent, onAccentChange }: SettingsProps) {
  function handleAccent(value: string) {
    onAccentChange(value)
    applyAccent(value)
  }

  const [dashCfg, setDashCfg] = useLocalStorage<DashboardConfig>(DASHBOARD_CFG_KEY, DEFAULT_DASHBOARD_CONFIG)
  function toggleCard(id: StatCardId) {
    setDashCfg(prev => {
      const want = new Set(prev.cards)
      if (want.has(id)) want.delete(id)
      else want.add(id)
      // Keep the master order so cards render consistently.
      return { ...prev, cards: STAT_CARDS.map(c => c.id).filter(c => want.has(c)) }
    })
  }

  const [calorieMethod, setCalorieMethod] = useState<'heart-rate' | 'distance'>('heart-rate')
  const [bodyWeightKg, setBodyWeightKg] = useState('70')
  const [sex, setSex] = useState<'male' | 'female' | ''>('')
  const [birthYear, setBirthYear] = useState('')
  const [heightCm, setHeightCm] = useState('')
  const [stepLengthCm, setStepLengthCm] = useState('')
  const [bioBusy, setBioBusy] = useState(false)
  const [bioMsg, setBioMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [calBusy, setCalBusy] = useState(false)
  const [calMsg, setCalMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const [maxHr, setMaxHr] = useState('')
  const [restingHr, setRestingHr] = useState('')
  const [thresholdPace, setThresholdPace] = useState('')
  const [ftp, setFtp] = useState('')
  const [perfBusy, setPerfBusy] = useState(false)
  const [perfMsg, setPerfMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    let active = true
    api.getPreferences()
      .then(p => {
        if (!active) return
        setCalorieMethod(p.calorieMethod)
        setBodyWeightKg(String(p.bodyWeightKg))
        setSex(p.sex ?? '')
        setBirthYear(p.birthYear ? String(p.birthYear) : '')
        setHeightCm(p.heightCm ? String(p.heightCm) : '')
        setStepLengthCm(p.stepLengthCm ? String(p.stepLengthCm) : '')
        setMaxHr(p.maxHr ? String(p.maxHr) : '')
        setRestingHr(p.restingHr ? String(p.restingHr) : '')
        setThresholdPace(p.thresholdPace)
        setFtp(p.ftp ? String(p.ftp) : '')
      })
      .catch(() => { /* fall back to defaults */ })
    return () => { active = false }
  }, [])

  function buildPayload() {
    return {
      calorieMethod,
      bodyWeightKg: Number(bodyWeightKg) || 70,
      sex,
      birthYear: Number(birthYear) || 0,
      heightCm: Number(heightCm) || 0,
      stepLengthCm: Number(stepLengthCm) || 0,
      maxHr: Number(maxHr) || 0,
      restingHr: Number(restingHr) || 0,
      thresholdPace,
      ftp: Number(ftp) || 0,
    }
  }

  async function saveBio() {
    setBioBusy(true); setBioMsg(null)
    try {
      const updated = await api.savePreferences(buildPayload())
      setBodyWeightKg(String(updated.bodyWeightKg))
      setSex(updated.sex ?? '')
      setBirthYear(updated.birthYear ? String(updated.birthYear) : '')
      setHeightCm(updated.heightCm ? String(updated.heightCm) : '')
      setStepLengthCm(updated.stepLengthCm ? String(updated.stepLengthCm) : '')
      setBioMsg({ ok: true, text: 'Saved' })
    } catch (e) {
      setBioMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Save failed' })
    } finally { setBioBusy(false) }
  }

  async function saveCalories() {
    setCalBusy(true); setCalMsg(null)
    try {
      const updated = await api.savePreferences(buildPayload())
      setBodyWeightKg(String(updated.bodyWeightKg))
      setCalMsg({ ok: true, text: 'Saved' })
    } catch (e) {
      setCalMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Save failed' })
    } finally { setCalBusy(false) }
  }

  async function savePerformance() {
    setPerfBusy(true); setPerfMsg(null)
    try {
      await api.savePreferences(buildPayload())
      setPerfMsg({ ok: true, text: 'Saved' })
    } catch (e) {
      setPerfMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Save failed' })
    } finally { setPerfBusy(false) }
  }

  return (
    <>
      <div className="page-header">
        <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>Settings</h1>
        <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>Appearance & preferences</p>
      </div>

      <div className="page-content" style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Accent color */}
        <section className="card">
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Accent Color</h3>
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16 }}>
            Used for active states, highlights, and interactive elements.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
            {ACCENTS.map(a => (
              <button
                key={a.value}
                onClick={() => handleAccent(a.value)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: `1.5px solid ${accent === a.value ? a.value : 'var(--border)'}`,
                  background: accent === a.value ? a.dim : 'var(--bg-3)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                <span style={{
                  width: 18, height: 18, borderRadius: '50%',
                  background: a.value, flexShrink: 0,
                  boxShadow: accent === a.value ? `0 0 8px ${a.glow}` : 'none',
                }} />
                <span style={{ fontSize: 12, fontWeight: 500, color: accent === a.value ? a.value : 'var(--text-2)', flex: 1, textAlign: 'left' }}>
                  {a.name}
                </span>
                {accent === a.value && <Check size={13} color={a.value} />}
              </button>
            ))}
          </div>
        </section>

        {/* Dashboard */}
        <section className="card">
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Dashboard</h3>
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16 }}>
            Choose which summary cards appear on your dashboard and the time window their
            totals (and the activity mix) are calculated over.
          </p>
          <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 6 }}>Stat cards</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
            {STAT_CARDS.map(c => {
              const on = dashCfg.cards.includes(c.id)
              return (
                <button
                  key={c.id}
                  onClick={() => toggleCard(c.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8,
                    border: `1px solid ${on ? 'var(--primary)' : 'var(--border)'}`,
                    background: on ? 'var(--primary-dim)' : 'var(--bg-3)',
                    color: on ? 'var(--primary)' : 'var(--text-2)',
                    fontSize: 12, fontWeight: 500, cursor: 'pointer',
                  }}
                >
                  {on && <Check size={13} />}
                  {c.label}
                </button>
              )
            })}
          </div>
          <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 6 }}>Time window</label>
          <select
            className="input"
            style={{ width: '100%', maxWidth: 220 }}
            value={dashCfg.windowDays}
            onChange={e => setDashCfg(prev => ({ ...prev, windowDays: Number(e.target.value) }))}
          >
            {WINDOW_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </section>

        {/* Units */}
        <section className="card">
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Units</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {['Metric (km, m)', 'Imperial (mi, ft)'].map(u => (
              <button
                key={u}
                style={{
                  flex: '1 1 160px', padding: '8px 12px',
                  borderRadius: 8, border: `1px solid ${u.includes('Metric') ? 'var(--primary)' : 'var(--border)'}`,
                  background: u.includes('Metric') ? 'var(--primary-dim)' : 'var(--bg-3)',
                  color: u.includes('Metric') ? 'var(--primary)' : 'var(--text-2)',
                  fontSize: 12, fontWeight: 500, cursor: 'pointer',
                }}
              >
                {u}
              </button>
            ))}
          </div>
        </section>

        {/* Physiology / About You */}
        <section className="card">
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>About You</h3>
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16 }}>
            Body metrics used to personalize calorie and effort estimates. Kept private to your account.
            Step length is used to estimate step counts from distance for runs and hikes.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Sex</label>
              <select className="input" style={{ width: '100%' }} value={sex} onChange={e => setSex(e.target.value as typeof sex)}>
                <option value="">Prefer not to say</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>
            <div style={{ minWidth: 0 }}>
              <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Birth year</label>
              <input className="input" type="number" min="1900" max={new Date().getFullYear()} placeholder="1990" style={{ width: '100%' }} value={birthYear} onChange={e => setBirthYear(e.target.value)} />
            </div>
            <div style={{ minWidth: 0 }}>
              <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Height (cm)</label>
              <input className="input" type="number" min="100" max="250" placeholder="175" style={{ width: '100%' }} value={heightCm} onChange={e => setHeightCm(e.target.value)} />
            </div>
            <div style={{ minWidth: 0 }}>
              <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Step length (cm)</label>
              <input className="input" type="number" min="30" max="200" placeholder="75" style={{ width: '100%' }} value={stepLengthCm} onChange={e => setStepLengthCm(e.target.value)} />
            </div>
            <div style={{ minWidth: 0 }}>
              <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Body weight (kg)</label>
              <input className="input" type="number" min="25" max="300" placeholder="70" style={{ width: '100%' }} value={bodyWeightKg} onChange={e => setBodyWeightKg(e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
            <button className="btn btn-primary" onClick={saveBio} disabled={bioBusy} style={{ opacity: bioBusy ? 0.5 : 1 }}>Save</button>
            {bioMsg && <span style={{ fontSize: 12, color: bioMsg.ok ? 'var(--primary)' : 'var(--red, #dc2626)' }}>{bioMsg.text}</span>}
          </div>
        </section>

        {/* Calorie estimation */}
        <section className="card">
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Calorie Estimation</h3>
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16 }}>
            Used to estimate calories burned when an imported workout doesn't already include them.
            The heart-rate method uses your sex, age, and weight from About You.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Method</label>
              <select className="input" style={{ width: '100%' }} value={calorieMethod} onChange={e => setCalorieMethod(e.target.value as typeof calorieMethod)}>
                <option value="heart-rate">Heart rate, then distance</option>
                <option value="distance">Distance only</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
            <button className="btn btn-primary" onClick={saveCalories} disabled={calBusy} style={{ opacity: calBusy ? 0.5 : 1 }}>Save</button>
            {calMsg && <span style={{ fontSize: 12, color: calMsg.ok ? 'var(--primary)' : 'var(--red, #dc2626)' }}>{calMsg.text}</span>}
          </div>
        </section>

        {/* HR zones */}
        <section className="card">
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Heart Rate & Performance</h3>
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16 }}>
            Max HR is used to compute heart-rate zones for workouts that don't report their own.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            {([
              { label: 'Max HR', value: maxHr, set: setMaxHr, unit: 'bpm', type: 'number', placeholder: '185' },
              { label: 'Resting HR', value: restingHr, set: setRestingHr, unit: 'bpm', type: 'number', placeholder: '52' },
              { label: 'Threshold Pace', value: thresholdPace, set: setThresholdPace, unit: '/km', type: 'text', placeholder: '5:00' },
              { label: 'FTP (Cycling)', value: ftp, set: setFtp, unit: 'W', type: 'number', placeholder: '240' },
            ] as const).map(f => (
              <div key={f.label} style={{ minWidth: 0 }}>
                <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>{f.label}</label>
                <div style={{ display: 'flex' }}>
                  <input
                    className="input"
                    type={f.type}
                    value={f.value}
                    placeholder={f.placeholder}
                    onChange={e => f.set(e.target.value)}
                    style={{ borderRadius: '6px 0 0 6px', flex: 1, minWidth: 0 }}
                  />
                  <span style={{
                    background: 'var(--bg-3)', border: '1px solid var(--border)', borderLeft: 'none',
                    borderRadius: '0 6px 6px 0', padding: '7px 8px', fontSize: 12, color: 'var(--text-3)',
                    fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', flexShrink: 0,
                  }}>{f.unit}</span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
            <button className="btn btn-primary" onClick={savePerformance} disabled={perfBusy} style={{ opacity: perfBusy ? 0.5 : 1 }}>Save</button>
            {perfMsg && <span style={{ fontSize: 12, color: perfMsg.ok ? 'var(--primary)' : 'var(--red, #dc2626)' }}>{perfMsg.text}</span>}
          </div>
        </section>
      </div>
    </>
  )
}
