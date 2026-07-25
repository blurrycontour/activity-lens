import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { ACCENTS, applyAccent } from '../lib/theme'
import { api, ApiError } from '../lib/api'

interface SettingsProps {
  accent: string
  onAccentChange: (a: string) => void
}

export default function Settings({ accent, onAccentChange }: SettingsProps) {
  function handleAccent(value: string) {
    onAccentChange(value)
    applyAccent(value)
  }

  const [calorieMethod, setCalorieMethod] = useState<'heart-rate' | 'distance'>('heart-rate')
  const [bodyWeightKg, setBodyWeightKg] = useState('70')
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
        setMaxHr(p.maxHr ? String(p.maxHr) : '')
        setRestingHr(p.restingHr ? String(p.restingHr) : '')
        setThresholdPace(p.thresholdPace)
        setFtp(p.ftp ? String(p.ftp) : '')
      })
      .catch(() => { /* fall back to defaults */ })
    return () => { active = false }
  }, [])

  async function saveCalories() {
    setCalBusy(true); setCalMsg(null)
    try {
      const updated = await api.savePreferences({
        calorieMethod, bodyWeightKg: Number(bodyWeightKg) || 70,
        maxHr: Number(maxHr) || 0, restingHr: Number(restingHr) || 0, thresholdPace, ftp: Number(ftp) || 0,
      })
      setBodyWeightKg(String(updated.bodyWeightKg))
      setCalMsg({ ok: true, text: 'Saved' })
    } catch (e) {
      setCalMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Save failed' })
    } finally { setCalBusy(false) }
  }

  async function savePerformance() {
    setPerfBusy(true); setPerfMsg(null)
    try {
      await api.savePreferences({
        calorieMethod, bodyWeightKg: Number(bodyWeightKg) || 70,
        maxHr: Number(maxHr) || 0, restingHr: Number(restingHr) || 0, thresholdPace, ftp: Number(ftp) || 0,
      })
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

        {/* Calorie estimation */}
        <section className="card">
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Calorie Estimation</h3>
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16 }}>
            Used to estimate calories burned when an imported workout doesn't already include them.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Method</label>
              <select className="input" style={{ width: '100%' }} value={calorieMethod} onChange={e => setCalorieMethod(e.target.value as typeof calorieMethod)}>
                <option value="heart-rate">Heart rate, then distance</option>
                <option value="distance">Distance only</option>
              </select>
            </div>
            <div style={{ minWidth: 0 }}>
              <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Body weight (kg)</label>
              <input className="input" type="number" min="25" max="300" style={{ width: '100%' }} value={bodyWeightKg} onChange={e => setBodyWeightKg(e.target.value)} />
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
