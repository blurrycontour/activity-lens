import { useState, useRef } from 'react'
import { Upload, X, CheckCircle, FileText, AlertCircle, ArrowRight } from 'lucide-react'
import { useWorkouts } from '../context/WorkoutsContext'
import { api, ApiError } from '../lib/api'
import { type Workout } from '../data/workouts'

interface ImportModalProps {
  onClose: () => void
  onViewWorkout?: (workout: Workout) => void
}

type Tab = 'file' | 'manual'

const SUPPORTED = ['gpx', 'tcx']

// parseDuration turns "mm:ss" or "h:mm:ss" into seconds (0 when empty/invalid).
function parseDuration(v: string): number {
  const parts = v.split(':').map(p => parseInt(p, 10))
  if (parts.some(isNaN)) return 0
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 1) return parts[0]
  return 0
}

export default function ImportModal({ onClose, onViewWorkout }: ImportModalProps) {
  const { refresh } = useWorkouts()
  const [tab, setTab] = useState<Tab>('file')
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [done, setDone] = useState(false)
  const [created, setCreated] = useState<Workout | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Manual form state
  const [form, setForm] = useState({
    name: '', type: 'Run', date: new Date().toISOString().split('T')[0],
    duration: '', distance: '', hr: '', elevation: '', notes: '',
  })

  function handleFile(f: File) {
    setFile(f)
    setError(null)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) handleFile(f)
  }

  async function handleImport() {
    setBusy(true)
    setError(null)
    try {
      let workout: Workout
      if (tab === 'file') {
        if (!file) return
        workout = await api.importWorkout(file, form.type)
      } else {
        workout = await api.createWorkout({
          name: form.name.trim(),
          type: form.type,
          date: form.date,
          duration: parseDuration(form.duration),
          distance: form.distance ? Math.round(parseFloat(form.distance) * 1000) : 0,
          avgHR: form.hr ? parseInt(form.hr, 10) : 0,
          maxHR: 0,
          elevationGain: form.elevation ? parseFloat(form.elevation) : 0,
          calories: 0,
          notes: form.notes.trim(),
        })
      }
      await refresh()
      setCreated(workout)
      setDone(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  const ext = file?.name.split('.').pop()?.toUpperCase() ?? ''
  const fileSupported = SUPPORTED.includes((file?.name.split('.').pop() ?? '').toLowerCase())

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal">
        <div className="modal-box">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 700 }}>Import Workout</h2>
              <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>Upload a file or enter details manually</p>
            </div>
            <button className="btn-icon" onClick={onClose}><X size={16} /></button>
          </div>

          {done ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <CheckCircle size={48} color="var(--primary)" style={{ margin: '0 auto 16px' }} />
              <p style={{ fontWeight: 700, fontSize: 16 }}>Workout Imported!</p>
              <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 6 }}>
                {tab === 'file' ? file?.name : form.name || 'New Workout'} has been added to your library.
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 20 }}>
                <button className="btn btn-ghost" onClick={onClose}>Done</button>
                {created && onViewWorkout && (
                  <button className="btn btn-primary" onClick={() => onViewWorkout(created)}>
                    View Workout <ArrowRight size={14} />
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Tabs */}
              <div style={{ display: 'flex', gap: 0, marginBottom: 20, background: 'var(--bg-3)', borderRadius: 10, padding: 4 }}>
                {([['file', '📁 File Upload'], ['manual', '✏️ Manual Entry']] as [Tab, string][]).map(([t, label]) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    style={{
                      flex: 1, padding: '7px 12px', borderRadius: 8, border: 'none',
                      fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s',
                      background: tab === t ? 'var(--bg-2)' : 'transparent',
                      color: tab === t ? 'var(--text)' : 'var(--text-3)',
                      boxShadow: tab === t ? '0 1px 4px rgba(0,0,0,0.3)' : 'none',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {tab === 'file' ? (
                <>
                  {/* Drop zone */}
                  {!file ? (
                    <div
                      onDragOver={e => { e.preventDefault(); setDragging(true) }}
                      onDragLeave={() => setDragging(false)}
                      onDrop={handleDrop}
                      onClick={() => fileRef.current?.click()}
                      style={{
                        border: `2px dashed ${dragging ? 'var(--primary)' : 'var(--border-strong)'}`,
                        borderRadius: 12, padding: '40px 24px', textAlign: 'center',
                        background: dragging ? 'var(--primary-dim)' : 'var(--bg-3)',
                        transition: 'all 0.15s', cursor: 'pointer',
                      }}
                    >
                      <Upload size={32} color={dragging ? 'var(--primary)' : 'var(--text-3)'} style={{ margin: '0 auto 12px' }} />
                      <p style={{ fontWeight: 600, fontSize: 14 }}>Drop your file here</p>
                      <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>or click to browse</p>
                      <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8, fontFamily: 'var(--font-mono)' }}>.gpx · .tcx</p>
                      <input ref={fileRef} type="file" accept=".gpx,.tcx" onChange={handleFileInput} style={{ display: 'none' }} />
                    </div>
                  ) : (
                    <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 16, background: 'var(--bg-3)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                          width: 44, height: 44, borderRadius: 10, background: 'var(--primary-dim)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <FileText size={20} color="var(--primary)" />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                            {ext} · {(file.size / 1024).toFixed(1)} KB
                          </div>
                        </div>
                        <button className="btn-icon" onClick={() => setFile(null)}><X size={14} /></button>
                      </div>
                      {fileSupported ? (
                        <div style={{ display: 'flex', gap: 6, marginTop: 12, alignItems: 'center', color: 'var(--primary)', fontSize: 12 }}>
                          <CheckCircle size={14} /> Format supported — ready to import
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 6, marginTop: 12, alignItems: 'center', color: '#ef4444', fontSize: 12 }}>
                          <AlertCircle size={14} /> Unsupported format. Use .gpx or .tcx
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                /* Manual entry form */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Workout Name *</label>
                      <input
                        className="input"
                        style={{ width: '100%' }}
                        placeholder="e.g. Morning Run"
                        value={form.name}
                        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Sport Type</label>
                      <select
                        className="select"
                        style={{ width: '100%' }}
                        value={form.type}
                        onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                      >
                        <option>Run</option>
                        <option>Ride</option>
                        <option>Hike</option>
                        <option>Swim</option>
                        <option>Strength</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Date</label>
                      <input
                        className="input"
                        style={{ width: '100%' }}
                        type="date"
                        value={form.date}
                        onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Duration (mm:ss or h:mm:ss)</label>
                      <input
                        className="input" style={{ width: '100%' }}
                        placeholder="e.g. 45:00"
                        value={form.duration}
                        onChange={e => setForm(f => ({ ...f, duration: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Distance (km)</label>
                      <input
                        className="input" style={{ width: '100%' }}
                        placeholder="e.g. 10.5"
                        type="number" step="0.01"
                        value={form.distance}
                        onChange={e => setForm(f => ({ ...f, distance: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Avg Heart Rate (bpm)</label>
                      <input
                        className="input" style={{ width: '100%' }}
                        placeholder="e.g. 155"
                        type="number"
                        value={form.hr}
                        onChange={e => setForm(f => ({ ...f, hr: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Elevation Gain (m)</label>
                      <input
                        className="input" style={{ width: '100%' }}
                        placeholder="e.g. 120"
                        type="number"
                        value={form.elevation}
                        onChange={e => setForm(f => ({ ...f, elevation: e.target.value }))}
                      />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Notes (optional)</label>
                      <textarea
                        className="input"
                        style={{ width: '100%', resize: 'vertical', minHeight: 60 }}
                        placeholder="How did it feel?"
                        value={form.notes}
                        onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>
              )}

              {error && (
                <div style={{ display: 'flex', gap: 6, marginTop: 16, alignItems: 'center', color: '#ef4444', fontSize: 12 }}>
                  <AlertCircle size={14} /> {error}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
                <button
                  className="btn btn-primary"
                  onClick={handleImport}
                  disabled={busy || (tab === 'file' ? (!file || !fileSupported) : !form.name.trim())}
                  style={{ opacity: (busy || (tab === 'file' ? (!file || !fileSupported) : !form.name.trim())) ? 0.4 : 1 }}
                >
                  {busy ? 'Importing…' : 'Import Workout'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
