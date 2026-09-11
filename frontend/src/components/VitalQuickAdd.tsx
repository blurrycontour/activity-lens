import { useState } from 'react'
import { Scale, HeartPulse, Calendar, Clock } from 'lucide-react'
import Modal from './Modal'
import StatusMsg, { type Msg } from './StatusMsg'
import { api, ApiError, type Vital } from '../lib/api'

export type VitalMode = 'weight' | 'bp'

/** Today and the current local minute, as separate date and time-input strings. */
function nowParts(): { date: string; time: string } {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

const TABS: [VitalMode, string, React.ReactNode][] = [
  ['weight', 'Weight', <Scale size={14} key="w" />],
  ['bp', 'Blood pressure', <HeartPulse size={14} key="b" />],
]

/**
 * A fast "log a measurement" sheet, opened from the Vitals section, the
 * dashboard speed-dial, or an Android home-screen shortcut. One dialog serves
 * both readings — a tab picks which — and the time defaults to now but can be
 * moved back for a reading taken earlier.
 */
export default function VitalQuickAdd({ mode: initialMode, onClose, onAdded }: {
  mode?: VitalMode
  onClose: () => void
  onAdded?: (v: Vital) => void
}) {
  const [mode, setMode] = useState<VitalMode>(initialMode ?? 'weight')
  const [{ date: today, time: nowTime }] = useState(nowParts)
  const [whenDate, setWhenDate] = useState(today)
  const [whenTime, setWhenTime] = useState(nowTime)
  const [weight, setWeight] = useState('')
  const [systolic, setSystolic] = useState('')
  const [diastolic, setDiastolic] = useState('')
  const [pulse, setPulse] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg | null>(null)

  const canSave = mode === 'weight'
    ? Number(weight) > 0
    : Number(systolic) > 0 && Number(diastolic) > 0

  async function onSave() {
    setBusy(true); setMsg(null)
    try {
      const measuredAt = whenDate ? new Date(`${whenDate}T${whenTime || '00:00'}`).toISOString() : undefined
      const payload = mode === 'weight'
        ? { measuredAt, weightKg: Number(weight), note: note.trim() }
        : {
            measuredAt,
            systolic: Number(systolic),
            diastolic: Number(diastolic),
            pulse: Number(pulse) || undefined,
            note: note.trim(),
          }
      const v = await api.addVital(payload)
      onAdded?.(v)
      onClose()
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Could not save' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={busy ? undefined : onClose} dismissable={!busy} label="Add measurement">
      <div className="modal-box vital-add" style={{ maxWidth: 380 }}>
        <h3 className="vital-add-title">Add measurement</h3>

        <div className="vital-add-tabs">
          {TABS.map(([t, label, icon]) => (
            <button
              key={t}
              type="button"
              className={`vital-add-tab${mode === t ? ' active' : ''}`}
              onClick={() => setMode(t)}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>

        <div className="vital-add-body">
          {mode === 'weight' ? (
            <div className="vital-field">
              <label className="form-label">Weight</label>
              <div className="input-unit">
                <input className="input" type="number" inputMode="decimal" min="1" max="500" autoFocus placeholder="70" value={weight} onChange={e => setWeight(e.target.value)} />
                <span>kg</span>
              </div>
            </div>
          ) : (
            <div className="vital-bp-grid">
              <div className="vital-field">
                <label className="form-label">Systolic</label>
                <div className="input-unit">
                  <input className="input" type="number" inputMode="numeric" min="40" max="300" autoFocus placeholder="120" value={systolic} onChange={e => setSystolic(e.target.value)} />
                  <span>mmHg</span>
                </div>
              </div>
              <div className="vital-field">
                <label className="form-label">Diastolic</label>
                <div className="input-unit">
                  <input className="input" type="number" inputMode="numeric" min="20" max="200" placeholder="80" value={diastolic} onChange={e => setDiastolic(e.target.value)} />
                  <span>mmHg</span>
                </div>
              </div>
              <div className="vital-field">
                <label className="form-label">Pulse <span className="form-label-opt">optional</span></label>
                <div className="input-unit">
                  <input className="input" type="number" inputMode="numeric" min="20" max="250" placeholder="60" value={pulse} onChange={e => setPulse(e.target.value)} />
                  <span>bpm</span>
                </div>
              </div>
            </div>
          )}

          <div className="vital-field">
            <label className="form-label">When</label>
            <div className="vital-datetime">
              {/* The native calendar/clock glyph is drawn by the platform, not
                  by us, and Android's WebView draws a plain chevron where
                  desktop Chrome draws an actual calendar — a custom icon on
                  top of the (hidden but still clickable) native one reads the
                  same everywhere. */}
              <span className="vital-dt-wrap">
                <input className="input" type="date" max={today} value={whenDate} onChange={e => setWhenDate(e.target.value)} />
                <Calendar size={15} className="vital-dt-icon" aria-hidden />
              </span>
              <span className="vital-dt-wrap">
                <input className="input" type="time" value={whenTime} onChange={e => setWhenTime(e.target.value)} />
                <Clock size={15} className="vital-dt-icon" aria-hidden />
              </span>
            </div>
          </div>

          <div className="vital-field">
            <label className="form-label">Note <span className="form-label-opt">optional</span></label>
            <input className="input" style={{ width: '100%' }} type="text" maxLength={200} placeholder="e.g. after coffee, left arm" value={note} onChange={e => setNote(e.target.value)} />
          </div>
        </div>

        {msg && <div style={{ marginTop: 4 }}><StatusMsg msg={msg} /></div>}

        <div className="vital-add-actions">
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={onSave} disabled={busy || !canSave}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
