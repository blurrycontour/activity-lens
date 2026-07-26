import { useState, useEffect, useCallback } from 'react'
import { Plus, Footprints, Watch, Bike, Shirt, Package, Pencil, Trash2, X, ChevronRight, ArrowLeft, AlertTriangle } from 'lucide-react'
import { api, type Equipment, type EquipmentInput, type LinkedWorkout } from '../lib/api'
import { fmtDuration, fmtDist } from '../data/workouts'

interface EquipmentPageProps {
  onSelectWorkout: (id: string) => void
}

const TYPES = [
  { id: 'shoes', label: 'Shoes' },
  { id: 'watch', label: 'Watch' },
  { id: 'bike', label: 'Bike' },
  { id: 'apparel', label: 'Apparel' },
  { id: 'other', label: 'Other' },
]

function typeIcon(type: string, size = 18) {
  switch (type) {
    case 'shoes': return <Footprints size={size} />
    case 'watch': return <Watch size={size} />
    case 'bike': return <Bike size={size} />
    case 'apparel': return <Shirt size={size} />
    default: return <Package size={size} />
  }
}

const EMPTY: EquipmentInput = { name: '', type: 'shoes', brand: '', model: '', notes: '', retired: false }

export default function EquipmentPage({ onSelectWorkout }: EquipmentPageProps) {
  const [items, setItems] = useState<Equipment[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Equipment | 'new' | null>(null)
  const [detail, setDetail] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setItems(await api.listEquipment())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  if (detail) {
    return <EquipmentDetail id={detail} onBack={() => { setDetail(null); void load() }} onSelectWorkout={onSelectWorkout} onEdit={e => setEditing(e)} onDeleted={() => { setDetail(null); void load() }} />
  }

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <h1 style={{ fontSize: 24, fontWeight: 700 }}>Equipment</h1>
            <span style={{ color: 'var(--text-3)', fontSize: 14 }}>{items.length} items</span>
          </div>
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            <Plus size={16} /> Add Equipment
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>Loading…</div>
      ) : items.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>
          No equipment yet. Add your shoes, watch, or bike to track their usage.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {items.map(e => (
            <div key={e.id} className="card" style={{ padding: 16, cursor: 'pointer', opacity: e.retired ? 0.6 : 1 }} onClick={() => setDetail(e.id)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ color: 'var(--primary)', flexShrink: 0 }}>{typeIcon(e.type, 22)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {e.name}
                    {e.retired && <span style={{ fontSize: 11, color: 'var(--text-3)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px' }}>Retired</span>}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {[e.brand, e.model].filter(Boolean).join(' ') || TYPES.find(t => t.id === e.type)?.label}
                  </div>
                </div>
                <ChevronRight size={16} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
              </div>
              <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-2)' }}>
                {e.workoutCount} {e.workoutCount === 1 ? 'workout' : 'workouts'}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <EquipmentForm
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load() }}
        />
      )}
    </div>
  )
}

function EquipmentDetail({ id, onBack, onSelectWorkout, onEdit, onDeleted }: {
  id: string
  onBack: () => void
  onSelectWorkout: (id: string) => void
  onEdit: (e: Equipment) => void
  onDeleted: () => void
}) {
  const [data, setData] = useState<(Equipment & { workouts: LinkedWorkout[] }) | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const load = useCallback(async () => {
    setData(await api.getEquipment(id))
  }, [id])

  useEffect(() => { void load() }, [load])

  async function doDelete() {
    await api.deleteEquipment(id)
    onDeleted()
  }

  if (!data) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>Loading…</div>

  return (
    <div>
      <button className="btn" onClick={onBack} style={{ marginBottom: 16 }}>
        <ArrowLeft size={16} /> Back
      </button>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ color: 'var(--primary)' }}>{typeIcon(data.type, 28)}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              {data.name}
              {data.retired && <span style={{ fontSize: 12, color: 'var(--text-3)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 6px' }}>Retired</span>}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 2 }}>
              {[TYPES.find(t => t.id === data.type)?.label, data.brand, data.model].filter(Boolean).join(' · ')}
            </div>
          </div>
          <button className="btn" onClick={() => onEdit(data)}><Pencil size={15} /> Edit</button>
          <button className="btn" style={{ color: '#ef4444' }} onClick={() => setConfirmDelete(true)}><Trash2 size={15} /> Delete</button>
        </div>
        {data.notes && <div style={{ marginTop: 14, fontSize: 14, color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>{data.notes}</div>}
      </div>

      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
        Linked workouts <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>({data.workouts.length})</span>
      </h2>
      {data.workouts.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)' }}>No workouts use this equipment yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.workouts.map(w => (
            <div key={w.id} className="card" style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }} onClick={() => onSelectWorkout(w.id)}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{w.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                  {new Date(w.date).toLocaleDateString()} · {w.type}
                </div>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-2)', textAlign: 'right' }}>
                <div>{fmtDist(w.distance)}</div>
                <div style={{ color: 'var(--text-3)' }}>{fmtDuration(w.duration)}</div>
              </div>
              <ChevronRight size={16} style={{ color: 'var(--text-3)' }} />
            </div>
          ))}
        </div>
      )}

      {confirmDelete && (
        <div className="overlay" onClick={() => setConfirmDelete(false)}>
          <div className="card" style={{ maxWidth: 420, padding: 24, margin: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <AlertTriangle size={20} style={{ color: '#f59e0b' }} />
              <h3 style={{ fontSize: 17, fontWeight: 700 }}>Delete equipment?</h3>
            </div>
            <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 20 }}>
              {data.workoutCount > 0
                ? `“${data.name}” is linked to ${data.workoutCount} ${data.workoutCount === 1 ? 'workout' : 'workouts'}. Deleting it will remove it from ${data.workoutCount === 1 ? 'that workout' : 'those workouts'}. This cannot be undone.`
                : `“${data.name}” will be permanently deleted. This cannot be undone.`}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button className="btn btn-primary" style={{ background: '#ef4444', borderColor: '#ef4444' }} onClick={() => void doDelete()}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function EquipmentForm({ initial, onClose, onSaved }: {
  initial: Equipment | null
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<EquipmentInput>(initial
    ? { name: initial.name, type: initial.type, brand: initial.brand, model: initial.model, notes: initial.notes, retired: initial.retired }
    : EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (!form.name.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError('')
    try {
      if (initial) await api.patchEquipment(initial.id, form)
      else await api.createEquipment(form)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
      setSaving(false)
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="card" style={{ maxWidth: 480, width: '100%', padding: 24, margin: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700 }}>{initial ? 'Edit equipment' : 'Add equipment'}</h3>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label className="field">
            <span>Name</span>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Nike Pegasus 40" />
          </label>
          <label className="field">
            <span>Type</span>
            <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
              {TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          <div style={{ display: 'flex', gap: 12 }}>
            <label className="field" style={{ flex: 1 }}>
              <span>Brand</span>
              <input value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} />
            </label>
            <label className="field" style={{ flex: 1 }}>
              <span>Model</span>
              <input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} />
            </label>
          </div>
          <label className="field">
            <span>Notes</span>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.retired} onChange={e => setForm({ ...form, retired: e.target.checked })} />
            Retired
          </label>
          {error && <div style={{ color: '#ef4444', fontSize: 13 }}>{error}</div>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}
