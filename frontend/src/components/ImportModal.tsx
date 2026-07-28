import { useState, useRef, useEffect } from 'react'
import { Upload, X, CheckCircle, FileText, AlertCircle, ArrowRight, Info, Loader2 } from 'lucide-react'
import { useWorkouts } from '../context/WorkoutsContext'
import { api, ApiError, type Equipment } from '../lib/api'
import { type Workout, fmtDist, fmtDuration, fmtPace } from '../data/workouts'

interface ImportModalProps {
  onClose: () => void
  onViewWorkout?: (workout: Workout) => void
  // Pre-selected file, set when the modal was opened by a file shared into the
  // app rather than by the user picking one.
  initialFile?: File | null
}

type Tab = 'file' | 'manual'

const SUPPORTED = ['gpx', 'tcx']

/** Stats shown for a parsed file, in order. The loading skeleton renders the
 * same labels in the same grid so the panel does not reflow when values land. */
const PREVIEW_FIELDS = ['Distance', 'Duration', 'Calories', 'Avg HR', 'Elevation', 'Avg Pace']

function previewRows(p: Workout): [string, string][] {
  return [
    ['Distance', p.distance > 0 ? fmtDist(p.distance) : '—'],
    ['Duration', p.duration > 0 ? fmtDuration(p.duration) : '—'],
    ['Calories', p.calories > 0 ? `${p.calories} kcal` : '—'],
    ['Avg HR', p.avgHR > 0 ? `${p.avgHR} bpm` : '—'],
    ['Elevation', p.elevationGain > 0 ? `${Math.round(p.elevationGain)} m` : '—'],
    ['Avg Pace', p.avgPace > 0 ? `${fmtPace(p.avgPace)} /km` : '—'],
  ]
}

// parseDuration turns "mm:ss" or "h:mm:ss" into seconds (0 when empty/invalid).
function parseDuration(v: string): number {
  const parts = v.split(':').map(p => parseInt(p, 10))
  if (parts.some(isNaN)) return 0
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 1) return parts[0]
  return 0
}

export default function ImportModal({ onClose, onViewWorkout, initialFile }: ImportModalProps) {
  const { refresh } = useWorkouts()
  const [tab, setTab] = useState<Tab>('file')
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(initialFile ?? null)
  const [done, setDone] = useState(false)
  const [created, setCreated] = useState<Workout | null>(null)
  // Set when the server recognised the file as already imported and returned
  // the existing workout rather than creating a second copy.
  const [duplicate, setDuplicate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<Workout | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Equipment selection (shared across both tabs)
  const [equipmentList, setEquipmentList] = useState<Equipment[]>([])
  const [selectedEquipment, setSelectedEquipment] = useState<string[]>([])
  useEffect(() => {
    api.listEquipment().then(list => setEquipmentList(list.filter(e => !e.retired))).catch(() => {})
  }, [])

  // Manual form state
  const [form, setForm] = useState({
    name: '', type: 'Run', date: new Date().toISOString().split('T')[0],
    duration: '', distance: '', hr: '', elevation: '', notes: '',
  })

  function handleFile(f: File) {
    setFile(f)
    setError(null)
    setPreview(null)
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
    setDuplicate(false)
    try {
      let workout: Workout
      if (tab === 'file') {
        if (!file) return
        const imported = await api.importWorkout(file, form.type, undefined, selectedEquipment)
        setDuplicate(imported.duplicate === true)
        workout = imported
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
          equipmentIds: selectedEquipment,
        })
      }
      await refresh()
      setCreated(workout)
      setDone(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add workout')
    } finally {
      setBusy(false)
    }
  }

  const ext = file?.name.split('.').pop()?.toUpperCase() ?? ''
  const fileSupported = SUPPORTED.includes((file?.name.split('.').pop() ?? '').toLowerCase())
  // On the file tab, wait for the preview to finish so the user cannot submit
  // before knowing what the file actually parses to (and before the derived
  // calorie estimate is folded in).
  const notReady = tab === 'file' ? (!file || !fileSupported || previewBusy) : !form.name.trim()
  const submitDisabled = busy || notReady

  // Fetch a non-persisted preview of the derived numbers once a supported file
  // is selected, so the user can review them before saving.
  useEffect(() => {
    if (tab !== 'file' || !file || !fileSupported) {
      setPreview(null)
      return
    }
    let active = true
    setPreviewBusy(true)
    setPreview(null)
    setError(null)
    api.previewWorkout(file, form.type)
      .then(w => { if (active) setPreview(w) })
      .catch(err => { if (active) setError(err instanceof ApiError ? err.message : 'Could not read file') })
      .finally(() => { if (active) setPreviewBusy(false) })
    return () => { active = false }
  }, [file, fileSupported, tab, form.type])

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal">
        <div className="modal-box">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 700 }}>Add Workout</h2>
              <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>Upload a file or enter details manually</p>
            </div>
            <button className="btn-icon" onClick={onClose}><X size={16} /></button>
          </div>

          {done ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              {duplicate ? (
                <Info size={48} color="var(--text-3)" style={{ margin: '0 auto 16px' }} />
              ) : (
                <CheckCircle size={48} color="var(--primary)" style={{ margin: '0 auto 16px' }} />
              )}
              <p style={{ fontWeight: 700, fontSize: 16 }}>{duplicate ? 'Already Imported' : 'Workout Added!'}</p>
              <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 6 }}>
                {duplicate
                  ? `${file?.name} matches a workout already in your library, so nothing was added.`
                  : `${tab === 'file' ? file?.name : form.name || 'New Workout'} has been added to your library.`}
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
                          <CheckCircle size={14} /> Format supported — ready to add
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 6, marginTop: 12, alignItems: 'center', color: '#ef4444', fontSize: 12 }}>
                          <AlertCircle size={14} /> Unsupported format. Use .gpx or .tcx
                        </div>
                      )}
                      {fileSupported && (previewBusy || preview) && (
                        <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>
                            {previewBusy && (
                              <Loader2 size={12} style={{ animation: 'spin 0.9s linear infinite', flexShrink: 0 }} />
                            )}
                            <span>{previewBusy ? 'Reading file — calculating stats…' : 'Preview'}</span>
                          </div>
                          {/* Skeleton in the shape of the real stat grid, so the
                              panel does not jump when the numbers land. */}
                          {previewBusy && (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 10 }}>
                              {PREVIEW_FIELDS.map(label => (
                                <div key={label}>
                                  <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
                                  <div
                                    className="skeleton"
                                    style={{ height: 15, width: '72%', borderRadius: 4, marginTop: 4 }}
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                          {preview && (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 10 }}>
                              {previewRows(preview).map(([label, value]) => (
                                <div key={label}>
                                  <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
                                  <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-mono)', marginTop: 2 }}>{value}</div>
                                </div>
                              ))}
                            </div>
                          )}
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

              {equipmentList.length > 0 && (
                <div style={{ marginTop: 18 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 8 }}>Equipment (optional)</label>
                  {selectedEquipment.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                      {selectedEquipment.map(id => {
                        const e = equipmentList.find(x => x.id === id)
                        if (!e) return null
                        return (
                          <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 8px 5px 12px', borderRadius: 20, fontSize: 12, border: '1px solid var(--primary)', background: 'var(--primary-dim)', color: 'var(--primary)' }}>
                            {e.name}
                            <button
                              type="button"
                              onClick={() => setSelectedEquipment(prev => prev.filter(x => x !== id))}
                              title="Remove"
                              style={{ display: 'inline-flex', border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', padding: 0 }}
                            >
                              <X size={13} />
                            </button>
                          </span>
                        )
                      })}
                    </div>
                  )}
                  {equipmentList.some(e => !selectedEquipment.includes(e.id)) && (
                    <select
                      className="select"
                      value=""
                      onChange={e => { if (e.target.value) setSelectedEquipment(prev => [...prev, e.target.value]) }}
                      style={{ width: '100%' }}
                    >
                      <option value="">+ Add equipment…</option>
                      {equipmentList.filter(e => !selectedEquipment.includes(e.id)).map(e => (
                        <option key={e.id} value={e.id}>{e.name}</option>
                      ))}
                    </select>
                  )}
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
                  disabled={submitDisabled}
                  style={{ opacity: submitDisabled ? 0.4 : 1 }}
                >
                  {busy ? 'Saving…' : 'Add Workout'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
