import { useState, useRef, useEffect, useCallback } from 'react'
import { Upload, X, CheckCircle, FileText, AlertCircle, ArrowRight, Info, Loader2, FolderOpen, PencilLine, Plus } from 'lucide-react'
import SportDropdown from './SportDropdown'
import Dropdown from './Dropdown'
import { useWorkouts } from '../context/WorkoutsContext'
import { isNative } from '../lib/serverConfig'
import { api, ApiError, type Equipment } from '../lib/api'
import { type Workout, type WorkoutType, fmtDist, fmtDuration, fmtPace } from '../data/workouts'
import BatchImportList from './BatchImportList'
import Modal from './Modal'
import {
  expand, preflight, runImport, summarize,
  type ImportItem, type ImportRunResult, type SkippedFile,
} from '../lib/importQueue'

interface ImportModalProps {
  onClose: () => void
  onViewWorkout?: (workout: Workout) => void
  // Files the modal was opened with, rather than picked in it: shared in from
  // the Android share sheet, or handed over by a desktop "Open with".
  initialFiles?: File[] | null
}

type Tab = 'file' | 'manual'

const SUPPORTED = ['gpx', 'tcx', 'fit']

/**
 * What the file picker offers. Archives are unpacked in the browser.
 *
 * Empty in the Android app, which is not laziness. Android's document picker
 * resolves an `accept` list to MIME types, and `.gpx`, `.tcx` and `.fit` have no
 * registered type — so every workout file renders greyed out and unselectable,
 * which looks exactly like a picker that has stopped responding to taps. An
 * unfiltered picker is the only one that can actually select these files, and
 * nothing is lost by it: what was chosen is validated by extension immediately
 * afterwards, the same as a dropped or shared file, which never passed through
 * `accept` in the first place.
 */
const ACCEPT_ATTR = isNative() ? '' : '.gpx,.tcx,.fit,.zip,.gz'

/** Where a batch is in its lifecycle. `null` items means single-file mode. */
type BatchPhase = 'expanding' | 'preflight' | 'review' | 'importing' | 'done'

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

export default function ImportModal({ onClose, onViewWorkout, initialFiles }: ImportModalProps) {
  const { refresh } = useWorkouts()
  const [tab, setTab] = useState<Tab>('file')
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)

  // Batch mode. `items` is null for a single file, which keeps that path — the
  // common one, and the one the share target uses — exactly as it was.
  const [items, setItems] = useState<ImportItem[] | null>(null)
  const [skipped, setSkipped] = useState<SkippedFile[]>([])
  const [phase, setPhase] = useState<BatchPhase>('review')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [batchResult, setBatchResult] = useState<ImportRunResult | null>(null)
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

  // Equipment selection (shared across both tabs). The section renders
  // immediately with a loading placeholder rather than waiting for the fetch
  // and popping in once it resolves — that pop-in was visibly resizing the
  // modal a moment after it opened.
  const [equipmentList, setEquipmentList] = useState<Equipment[]>([])
  const [equipmentLoading, setEquipmentLoading] = useState(true)
  const [selectedEquipment, setSelectedEquipment] = useState<string[]>([])
  useEffect(() => {
    api.listEquipment()
      .then(list => setEquipmentList(list.filter(e => !e.retired)))
      .catch(() => {})
      .finally(() => setEquipmentLoading(false))
  }, [])

  /**
   * The sport for the single file being imported, once the user has changed it.
   *
   * Empty means "whatever the file said", which is what the preview shows. Kept
   * separate from the manual form's `type`: that one has to be a sport, because
   * a typed-in workout has no file to ask — sharing the two is what made every
   * upload arrive claiming to be a Run.
   *
   * A batch has no equivalent here. Each file carries its own choice, because
   * an export archive is a year of mixed activities and one setting across all
   * of them can only ever be right for the files that already agreed with it.
   */
  const [singleType, setSingleType] = useState<WorkoutType | ''>('')

  // Manual form state
  const [form, setForm] = useState({
    name: '', type: 'Run' as WorkoutType, date: new Date().toISOString().split('T')[0],
    duration: '', distance: '', hr: '', elevation: '', notes: '',
  })

  /**
   * Takes whatever the user handed over — one file, fifty, or an export archive
   * — and decides which of the two modes to be in.
   *
   * A single workout file stays on the original single-file path: it is the
   * common case, and a list of one would be a worse view of it than the preview
   * panel. Anything else becomes a batch, including one file plus something
   * unusable, so the modal can account for every file that was selected.
   */
  const handleFiles = useCallback(async (selected: File[]) => {
    if (selected.length === 0) return
    setError(null)
    setPreview(null)
    setSingleType('')
    setFile(null)
    setItems([])
    setSkipped([])
    setPhase('expanding')

    let expanded
    try {
      expanded = await expand(selected)
    } catch {
      setItems(null)
      setPhase('review')
      setError('Could not read those files')
      return
    }

    if (expanded.files.length === 1 && expanded.skipped.length === 0) {
      setItems(null)
      setPhase('review')
      setFile(expanded.files[0])
      return
    }
    if (expanded.files.length === 0) {
      setItems([])
      setSkipped(expanded.skipped)
      setPhase('review')
      setError('None of those files could be imported')
      return
    }

    setSkipped(expanded.skipped)
    setPhase('preflight')
    setProgress({ done: 0, total: expanded.files.length })
    try {
      const checked = await preflight(expanded.files, {
        onProgress: (done, total) => setProgress({ done, total }),
      })
      setItems(checked)
    } catch {
      setError('Could not read those files')
    } finally {
      setPhase('review')
    }
  }, [])

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    void handleFiles(Array.from(e.dataTransfer.files))
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    void handleFiles(Array.from(e.target.files ?? []))
  }

  // Files that arrived from outside the app (share sheet, "Open with") go
  // through exactly the same intake as a manual pick, so an archive shared in
  // from a phone unpacks the same way it would on the desktop.
  useEffect(() => {
    if (initialFiles?.length) void handleFiles(initialFiles)
    // Deliberately once per mount: the modal is remounted per share.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Runs the batch the user reviewed. */
  async function handleBatchImport() {
    if (!items) return
    setError(null)
    setPhase('importing')
    setProgress({ done: 0, total: items.filter(i => i.status === 'ready').length })
    const result = await runImport(items, {
      equipmentIds: selectedEquipment,
      onItemChange: () => setItems(prev => (prev ? [...prev] : prev)),
      onProgress: (done, total) => setProgress({ done, total }),
    })
    await refresh()
    setBatchResult(result)
    setPhase('done')
  }

  async function handleImport() {
    setBusy(true)
    setError(null)
    setDuplicate(false)
    try {
      let workout: Workout
      if (tab === 'file') {
        if (!file) return
        // Empty unless the user picked one, in which case it overrules the
        // file. Sending form.type here — the manual tab's field, defaulting to
        // Run — is what made every upload silently claim to be a run.
        const imported = await api.importWorkout(file, singleType || undefined, undefined, selectedEquipment)
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
  // Batch-mode derived state. Null in single-file mode, which leaves every
  // expression below reading exactly as it did before.
  const batchCounts = items !== null ? summarize(items, skipped) : null
  const batchBusy = phase === 'expanding' || phase === 'preflight' || phase === 'importing'

  const notReady = tab === 'file'
    ? batchCounts
      ? batchBusy || batchCounts.ready === 0
      : (!file || !fileSupported || previewBusy)
    : !form.name.trim()
  const submitDisabled = busy || notReady

  /*
   * Fetch a non-persisted preview of the derived numbers once a supported file
   * is selected, so the user can review them before saving.
   *
   * Keyed on the file and nothing else. It used to depend on the open tab too,
   * which meant a look at Manual Entry and back threw the preview away and
   * parsed the file again — a second upload of the whole thing, and a wait, to
   * arrive at the numbers already on screen a moment earlier. Which tab is
   * showing is a question about what to draw, not about what is known.
   */
  const previewedFile = useRef<File | null>(null)
  useEffect(() => {
    if (!file || !fileSupported) {
      previewedFile.current = null
      setPreview(null)
      return
    }
    // Already asked about this exact file: either the answer is on screen or it
    // is on its way. A File is identity-compared on purpose — re-picking the
    // same path hands back a new object, which is the one case where asking
    // again is right.
    if (previewedFile.current === file) return
    previewedFile.current = file
    let active = true
    setPreviewBusy(true)
    setPreview(null)
    setError(null)
    // Deliberately without the chosen type: this call is what the file says,
    // and the picker needs that to stay visible so someone can see what they
    // are overriding. Sending the override would make the preview echo the
    // user's own choice back at them, and would refetch on every change of it.
    api.previewWorkout(file)
      .then(w => { if (active) setPreview(w) })
      .catch(err => { if (active) setError(err instanceof ApiError ? err.message : 'Could not read file') })
      .finally(() => { if (active) setPreviewBusy(false) })
    return () => { active = false }
  }, [file, fileSupported])

  return (
    <Modal onClose={onClose} label="Add workout">
        <div className="modal-box">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 700 }}>Add Workout</h2>
              <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>Upload a file or enter details manually</p>
            </div>
            <button className="btn-icon" onClick={onClose} aria-label="Close"><X size={16} /></button>
          </div>

          {phase === 'done' && batchResult ? (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <CheckCircle size={48} color="var(--primary)" style={{ margin: '0 auto 16px' }} />
              <p style={{ fontWeight: 700, fontSize: 16 }}>
                {batchResult.imported > 0
                  ? `${batchResult.imported} workout${batchResult.imported === 1 ? '' : 's'} added`
                  : 'Nothing new to add'}
              </p>
              {/* Every file the user selected is accounted for, so a count that
                  is lower than expected has a visible reason. */}
              <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 6 }}>
                {[
                  batchResult.duplicates > 0 && `${batchResult.duplicates} already in your library`,
                  batchResult.failed > 0 && `${batchResult.failed} could not be imported`,
                  skipped.length > 0 && `${skipped.length} skipped`,
                ].filter(Boolean).join(' · ') || 'All files imported cleanly.'}
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 20 }}>
                <button className="btn btn-primary" onClick={onClose}>Done</button>
              </div>
            </div>
          ) : done ? (
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
                {([
                  ['file', 'File Upload', <FolderOpen size={14} key="f" />],
                  ['manual', 'Manual Entry', <PencilLine size={14} key="m" />],
                ] as [Tab, string, React.ReactNode][]).map(([t, label, icon]) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    style={{
                      flex: 1, padding: '7px 12px', borderRadius: 8, border: 'none',
                      fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s',
                      background: tab === t ? 'var(--bg-2)' : 'transparent',
                      color: tab === t ? 'var(--text)' : 'var(--text-3)',
                      boxShadow: tab === t ? '0 1px 4px rgba(0,0,0,0.3)' : 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}
                  >
                    {icon}
                    {label}
                  </button>
                ))}
              </div>

              {tab === 'file' ? (
                <>
                  {/* A batch replaces the single-file preview entirely: nobody
                      reviews fifty stat panels, so the useful view is which
                      files will import and which will not. */}
                  {items !== null ? (
                    <BatchImportList
                      items={items}
                      skipped={skipped}
                      busyLabel={
                        phase === 'expanding' ? 'Unpacking…'
                          : phase === 'preflight' ? 'Reading files…'
                            : phase === 'importing' ? 'Importing…'
                              : undefined
                      }
                      progress={phase === 'preflight' || phase === 'importing' ? progress : undefined}
                      onRemove={phase === 'review' ? id => setItems(prev => prev?.filter(i => i.id !== id) ?? prev) : undefined}
                      onTypeChange={phase === 'review'
                        ? (id, type) => setItems(prev => prev?.map(i => (i.id === id ? { ...i, type } : i)) ?? prev)
                        : undefined}
                    />
                  ) : !file ? (
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
                      <p style={{ fontWeight: 600, fontSize: 14 }}>Drop your files here</p>
                      <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>or click to browse — several at once is fine</p>
                      <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8, fontFamily: 'var(--font-mono)' }}>.fit · .gpx · .tcx · .zip</p>
                      <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>
                        A Strava or Garmin export .zip can be dropped in whole.
                      </p>
                      <input ref={fileRef} type="file" multiple accept={ACCEPT_ATTR || undefined} onChange={handleFileInput} style={{ display: 'none' }} />
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
                        <div style={{ display: 'flex', gap: 6, marginTop: 12, alignItems: 'center', color: 'var(--danger)', fontSize: 12 }}>
                          <AlertCircle size={14} /> Unsupported format. Use .fit, .gpx or .tcx
                        </div>
                      )}
                      {fileSupported && (previewBusy || preview) && (
                        <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>
                            {previewBusy && (
                              <Loader2 size={12} className="spin" style={{ flexShrink: 0 }} />
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
                          {/* The sport sits with the other parsed values, as
                              the one of them that can be corrected. Showing the
                              detection here rather than beside a separate
                              control means the value being changed and the
                              value read from the file are the same thing. */}
                          {preview && (
                            <div style={{ marginBottom: 12 }}>
                              <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                                Sport
                              </div>
                              <div style={{ maxWidth: 200 }}>
                                <SportDropdown
                                  value={singleType || preview.type}
                                  onChange={setSingleType}
                                />
                              </div>
                              {preview.type === 'Other' && !singleType && (
                                <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 5, lineHeight: 1.5 }}>
                                  This file does not say what it is. Pick a sport, or it is saved as Other.
                                </p>
                              )}
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
                      <label className="form-label">Workout Name *</label>
                      <input
                        className="input"
                        style={{ width: '100%' }}
                        placeholder="e.g. Morning Run"
                        value={form.name}
                        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="form-label">Sport Type</label>
                      <SportDropdown value={form.type} onChange={t => setForm(f => ({ ...f, type: t }))} />
                    </div>
                    <div>
                      <label className="form-label">Date</label>
                      <input
                        className="input"
                        style={{ width: '100%' }}
                        type="date"
                        value={form.date}
                        onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="form-label">Duration (mm:ss or h:mm:ss)</label>
                      <input
                        className="input" style={{ width: '100%' }}
                        placeholder="e.g. 45:00"
                        value={form.duration}
                        onChange={e => setForm(f => ({ ...f, duration: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="form-label">Distance (km)</label>
                      <input
                        className="input" style={{ width: '100%' }}
                        placeholder="e.g. 10.5"
                        type="number" step="0.01"
                        value={form.distance}
                        onChange={e => setForm(f => ({ ...f, distance: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="form-label">Avg Heart Rate (bpm)</label>
                      <input
                        className="input" style={{ width: '100%' }}
                        placeholder="e.g. 155"
                        type="number"
                        value={form.hr}
                        onChange={e => setForm(f => ({ ...f, hr: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="form-label">Elevation Gain (m)</label>
                      <input
                        className="input" style={{ width: '100%' }}
                        placeholder="e.g. 120"
                        type="number"
                        value={form.elevation}
                        onChange={e => setForm(f => ({ ...f, elevation: e.target.value }))}
                      />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label className="form-label">Notes (optional)</label>
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

              {/* Always rendered, including before the fetch resolves and even
                  when the account has no equipment yet, so the modal's height
                  never jumps once it's open. */}
              <div style={{ marginTop: 18 }}>
                <label className="form-label" style={{ marginBottom: 8 }}>
                  {batchCounts && batchCounts.ready > 1
                    ? `Equipment (optional) — applied to all ${batchCounts.ready}`
                    : 'Equipment (optional)'}
                </label>
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
                {equipmentLoading ? (
                  <div className="skeleton" style={{ height: 34, borderRadius: 'var(--radius)' }} />
                ) : equipmentList.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '8px 0' }}>
                    No equipment added yet — add some from the Equipment page.
                  </div>
                ) : (
                  equipmentList.some(e => !selectedEquipment.includes(e.id)) && (
                    <Dropdown
                      value=""
                      placeholder="Add equipment…"
                      onChange={id => { if (id) setSelectedEquipment(prev => [...prev, id]) }}
                      block
                      icon={<Plus size={13} color="var(--text-3)" style={{ flexShrink: 0 }} />}
                      ariaLabel="Add equipment"
                      options={equipmentList.filter(e => !selectedEquipment.includes(e.id)).map(e => ({ value: e.id, label: e.name }))}
                    />
                  )
                )}
              </div>

              {error && (
                <div style={{ display: 'flex', gap: 6, marginTop: 16, alignItems: 'center', color: 'var(--danger)', fontSize: 12 }}>
                  <AlertCircle size={14} /> {error}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end', alignItems: 'center' }}>
                {/* The breakdown lives beside the button rather than inside it:
                    the count of what will import is the decision, and why the
                    rest will not is the explanation. */}
                {batchCounts && (batchCounts.duplicates > 0 || batchCounts.errors > 0) && (
                  <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: 'var(--text-3)' }}>
                    {[
                      batchCounts.duplicates > 0 && `${batchCounts.duplicates} already imported`,
                      batchCounts.errors > 0 && `${batchCounts.errors} unreadable`,
                    ].filter(Boolean).join(' · ')}
                  </span>
                )}
                <button className="btn btn-ghost" onClick={onClose} disabled={busy || batchBusy}>Cancel</button>
                <button
                  className="btn btn-primary"
                  onClick={batchCounts ? handleBatchImport : handleImport}
                  disabled={submitDisabled}
                  style={{ opacity: submitDisabled ? 0.4 : 1 }}
                >
                  {batchCounts
                    ? batchBusy
                      ? 'Importing…'
                      : `Import ${batchCounts.ready} of ${batchCounts.total}`
                    : busy ? 'Saving…' : 'Add Workout'}
                </button>
              </div>
            </>
          )}
        </div>
    </Modal>
  )
}
