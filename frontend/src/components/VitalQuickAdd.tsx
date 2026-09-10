import { useState } from 'react'
import Modal from './Modal'
import Segmented from './Segmented'
import Field from './Field'
import StatusMsg, { type Msg } from './StatusMsg'
import { api, ApiError, type Vital } from '../lib/api'

export type VitalMode = 'weight' | 'bp'

/**
 * A fast "log a measurement" sheet, opened from the Vitals section or straight
 * from an Android home-screen shortcut. One dialog serves both readings — a
 * toggle picks which — so there is a single place to add anything.
 */
export default function VitalQuickAdd({ mode: initialMode, onClose, onAdded }: {
  mode?: VitalMode
  onClose: () => void
  onAdded?: (v: Vital) => void
}) {
  const [mode, setMode] = useState<VitalMode>(initialMode ?? 'weight')
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
      const payload = mode === 'weight'
        ? { weightKg: Number(weight), note: note.trim() }
        : {
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
      <div className="modal-box" style={{ maxWidth: 360 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Add measurement</h3>

        <div style={{ marginBottom: 16 }}>
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { id: 'weight', label: 'Weight' },
              { id: 'bp', label: 'Blood pressure' },
            ]}
          />
        </div>

        {mode === 'weight' ? (
          <Field label="Weight">
            <div className="input-unit">
              <input
                className="input"
                type="number"
                inputMode="decimal"
                min="1"
                max="500"
                autoFocus
                placeholder="70"
                value={weight}
                onChange={e => setWeight(e.target.value)}
              />
              <span>kg</span>
            </div>
          </Field>
        ) : (
          <div className="field-grid">
            <Field label="Systolic">
              <div className="input-unit">
                <input className="input" type="number" inputMode="numeric" min="40" max="300" autoFocus placeholder="120" value={systolic} onChange={e => setSystolic(e.target.value)} />
                <span>mmHg</span>
              </div>
            </Field>
            <Field label="Diastolic">
              <div className="input-unit">
                <input className="input" type="number" inputMode="numeric" min="20" max="200" placeholder="80" value={diastolic} onChange={e => setDiastolic(e.target.value)} />
                <span>mmHg</span>
              </div>
            </Field>
            <Field label="Pulse" info="Optional.">
              <div className="input-unit">
                <input className="input" type="number" inputMode="numeric" min="20" max="250" placeholder="60" value={pulse} onChange={e => setPulse(e.target.value)} />
                <span>bpm</span>
              </div>
            </Field>
          </div>
        )}

        <Field label="Note" info="Optional — e.g. time of day or which arm.">
          <input className="input" type="text" maxLength={200} placeholder="" value={note} onChange={e => setNote(e.target.value)} style={{ width: '100%' }} />
        </Field>

        {msg && <div style={{ marginTop: 10 }}><StatusMsg msg={msg} /></div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={onSave} disabled={busy || !canSave}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
