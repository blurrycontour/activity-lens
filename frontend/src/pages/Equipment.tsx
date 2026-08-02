import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Plus, Watch, Bike, Shirt, Package, SportShoe, Pencil, Trash2, X, ChevronRight,
  ArrowLeft, AlertTriangle, Search, SlidersHorizontal, ArrowDownWideNarrow, Layers,
} from 'lucide-react'
import { api, type Equipment, type EquipmentInput, type LinkedWorkout } from '../lib/api'
import { useRefreshHandler } from '../context/RefreshContext'
import { useIsMobile } from '../lib/useIsMobile'
import Dropdown, { type DropdownOption } from '../components/Dropdown'
import FilterSheet from '../components/FilterSheet'
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

type SortField = 'name' | 'workouts' | 'distance' | 'wear' | 'type'

function typeIcon(type: string, size = 18, color?: string) {
  switch (type) {
    case 'shoes': return <SportShoe size={size} color={color} />
    case 'watch': return <Watch size={size} color={color} />
    case 'bike': return <Bike size={size} color={color} />
    case 'apparel': return <Shirt size={size} color={color} />
    default: return <Package size={size} color={color} />
  }
}

/**
 * Gear marks in a menu, in the accent the list rows already draw them in.
 * Unlike a sport, a gear type has no colour of its own to carry.
 */
const typeGlyph = (id: string) => typeIcon(id, 14, 'var(--primary)')

/** Filter and sort choices, shared by the desktop dropdowns and mobile sheet. */
const TYPE_OPTIONS: DropdownOption<string>[] = [
  { value: 'all', label: 'All types', glyph: <Layers size={14} color="var(--text-3)" aria-hidden /> },
  ...TYPES.map(t => ({ value: t.id, label: t.label, glyph: typeGlyph(t.id) })),
]

/** The same list without "all", for the add and edit form. */
const FORM_TYPE_OPTIONS: DropdownOption<string>[] = TYPES.map(t => ({
  value: t.id, label: t.label, glyph: typeGlyph(t.id),
}))

const SORT_OPTIONS: DropdownOption<SortField>[] = [
  { value: 'name', label: 'By name', short: 'A→Z' },
  { value: 'workouts', label: 'Most used', short: '↓' },
  { value: 'distance', label: 'Longest distance', short: '↓' },
  { value: 'wear', label: 'Most worn', short: '↓' },
  { value: 'type', label: 'By type', short: '·' },
]


const EMPTY: EquipmentInput = { name: '', type: 'shoes', brand: '', model: '', notes: '', retired: false, retireAtKm: 0 }

/** Replacement distance suggested per type when the user hasn't set one. */
const DEFAULT_RETIRE_KM: Record<string, number> = { shoes: 600 }

/** A gear item's wear against its replacement distance, or null when the type
 *  has no distance-based wear limit (a watch doesn't wear out by the km). */
function wearOf(e: { type: string; totalDistance?: number; retireAtKm?: number }) {
  const limitKm = e.retireAtKm && e.retireAtKm > 0 ? e.retireAtKm : DEFAULT_RETIRE_KM[e.type] ?? 0
  const km = Math.round((e.totalDistance ?? 0) / 1000)
  if (limitKm <= 0) return { km, limitKm: 0, pct: 0 }
  return { km, limitKm, pct: km / limitKm }
}

export default function EquipmentPage({ onSelectWorkout }: EquipmentPageProps) {
  const [items, setItems] = useState<Equipment[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Equipment | 'new' | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<SortField>('name')
  const [showFilters, setShowFilters] = useState(false)
  const isMobile = useIsMobile()

  /** What is currently narrowing the list, as dismissible chips on mobile. */
  const activeFilters = useMemo(() => {
    const out: { key: string; label: string; clear: () => void }[] = []
    if (typeFilter !== 'all') {
      out.push({
        key: 'type',
        label: TYPE_OPTIONS.find(o => o.value === typeFilter)?.label ?? typeFilter,
        clear: () => setTypeFilter('all'),
      })
    }
    if (sortBy !== 'name') {
      out.push({
        key: 'sort',
        label: SORT_OPTIONS.find(o => o.value === sortBy)?.label ?? sortBy,
        clear: () => setSortBy('name'),
      })
    }
    return out
  }, [typeFilter, sortBy])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setItems(await api.listEquipment())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])
  // Equipment fetches its own data rather than reading the workout cache, so it
  // has to opt into pull-to-refresh itself.
  useRefreshHandler(load)

  const filtered = useMemo(() => {
    let result = [...items]
    if (typeFilter !== 'all') result = result.filter(e => e.type === typeFilter)
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(e =>
        e.name.toLowerCase().includes(q) ||
        e.brand.toLowerCase().includes(q) ||
        e.model.toLowerCase().includes(q))
    }
    result.sort((a, b) => {
      if (sortBy === 'workouts') return b.workoutCount - a.workoutCount
      if (sortBy === 'distance') return (b.totalDistance ?? 0) - (a.totalDistance ?? 0)
      if (sortBy === 'wear') return wearOf(b).pct - wearOf(a).pct
      if (sortBy === 'type') return a.type.localeCompare(b.type) || a.name.localeCompare(b.name)
      return a.name.localeCompare(b.name)
    })
    return result
  }, [items, search, typeFilter, sortBy])

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: detail ? 0 : 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <h1 style={{ fontSize: 20, fontWeight: 700 }}>Equipment</h1>
            <span style={{ color: 'var(--text-3)', fontSize: 13, fontFamily: 'var(--font-mono)' }}>
              {detail ? `${items.length} ${items.length === 1 ? 'item' : 'items'}` : `${filtered.length} of ${items.length}`}
            </span>
          </div>
          {!detail && (
            <button className="btn btn-primary" onClick={() => setEditing('new')}>
              <Plus size={16} /> Add Equipment
            </button>
          )}
        </div>

        {/* Mirrors the Workouts header: search plus dropdowns on a desktop, and
            on a phone a single filter button opening a sheet, with whatever is
            applied shown as dismissible chips underneath. Three controls
            side by side wrap to three rows on a phone and push the list itself
            below the fold. */}
        {!detail && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
              <Search size={14} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', pointerEvents: 'none' }} />
              <input
                className="input"
                placeholder="Search equipment..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ paddingLeft: 30, width: '100%' }}
              />
            </div>

            {isMobile ? (
              <button
                className="btn btn-ghost filter-btn"
                onClick={() => setShowFilters(true)}
                aria-label={`Filters${activeFilters.length ? `, ${activeFilters.length} applied` : ''}`}
              >
                <SlidersHorizontal size={15} />
                {activeFilters.length > 0 && <span className="filter-count">{activeFilters.length}</span>}
              </button>
            ) : (
              <>
                <Dropdown
                  value={typeFilter}
                  options={TYPE_OPTIONS}
                  onChange={setTypeFilter}
                  ariaLabel="Equipment type"
                />
                <Dropdown
                  value={sortBy}
                  options={SORT_OPTIONS}
                  onChange={setSortBy}
                  ariaLabel="Sort order"
                  icon={<ArrowDownWideNarrow size={13} color="var(--text-3)" style={{ flexShrink: 0 }} />}
                />
              </>
            )}
          </div>
        )}

        {!detail && isMobile && activeFilters.length > 0 && (
          <div className="active-filters">
            {activeFilters.map(f => (
              <span key={f.key} className="active-filter">
                {f.label}
                <button onClick={f.clear} aria-label={`Clear ${f.label}`}><X size={11} /></button>
              </span>
            ))}
          </div>
        )}
      </div>

      {showFilters && (
        <FilterSheet
          groups={[
            {
              key: 'type', label: 'Type', value: typeFilter,
              onChange: v => setTypeFilter(v as string),
              options: TYPE_OPTIONS.map(o => ({ value: o.value, label: o.label, glyph: o.glyph })),
            },
            {
              key: 'sort', label: 'Sort by', value: sortBy,
              onChange: v => setSortBy(v as SortField),
              options: SORT_OPTIONS.map(o => ({ value: o.value, label: o.label })),
            },
          ]}
          onReset={() => { setTypeFilter('all'); setSortBy('name') }}
          onClose={() => setShowFilters(false)}
        />
      )}

      <div className="page-content tight">
        {detail ? (
          <EquipmentDetail
            id={detail}
            onBack={() => { setDetail(null); void load() }}
            onSelectWorkout={onSelectWorkout}
            onEdit={e => setEditing(e)}
            onDeleted={() => { setDetail(null); void load() }}
          />
        ) : loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>Loading…</div>
        ) : items.length === 0 ? (
          <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>
            No equipment yet. Add your shoes, watch, or bike to track their usage.
          </div>
        ) : filtered.length === 0 ? (
          <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>
            No equipment matches your filters.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {filtered.map(e => (
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
                <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-2)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <span>{e.workoutCount} {e.workoutCount === 1 ? 'workout' : 'workouts'}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>{wearOf(e).km.toLocaleString()} km</span>
                </div>
                {(() => {
                  const wear = wearOf(e)
                  if (wear.limitKm <= 0) return null
                  return (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ background: 'var(--bg-3)', borderRadius: 99, height: 4 }}>
                        <div style={{
                          width: `${Math.min(wear.pct, 1) * 100}%`, height: '100%', borderRadius: 99,
                          background: wear.pct >= 1 ? 'var(--danger)' : wear.pct >= 0.8 ? 'var(--warning)' : 'var(--primary)',
                        }} />
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
                        {Math.round(wear.pct * 100)}% of {wear.limitKm.toLocaleString()} km
                      </div>
                    </div>
                  )
                })()}
              </div>
            ))}
          </div>
        )}
      </div>

      {!detail && (
        <button className="fab" onClick={() => setEditing('new')} title="Add Equipment" aria-label="Add equipment">
          <Plus size={24} strokeWidth={2.5} />
        </button>
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
      <button className="btn btn-ghost" onClick={onBack} style={{ marginBottom: 16 }}>
        <ArrowLeft size={16} /> Back
      </button>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--primary)' }}>{typeIcon(data.type, 28)}</span>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontSize: 20, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              {data.name}
              {data.retired && <span style={{ fontSize: 12, color: 'var(--text-3)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 6px' }}>Retired</span>}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 2 }}>
              {[TYPES.find(t => t.id === data.type)?.label, data.brand, data.model].filter(Boolean).join(' · ')}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" onClick={() => onEdit(data)}><Pencil size={15} /> Edit</button>
            <button className="btn btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => setConfirmDelete(true)}><Trash2 size={15} /> Delete</button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginTop: 16 }}>
          <div className="stat-chip">
            <span className="label">Workouts</span>
            <span className="value" style={{ fontSize: 14 }}>{data.workoutCount}</span>
          </div>
          <div className="stat-chip">
            <span className="label">Distance</span>
            <span className="value" style={{ fontSize: 14 }}>{wearOf(data).km.toLocaleString()} km</span>
          </div>
          <div className="stat-chip">
            <span className="label">Time</span>
            <span className="value" style={{ fontSize: 14 }}>{Math.round((data.totalDuration ?? 0) / 3600)} h</span>
          </div>
          {wearOf(data).limitKm > 0 && (
            <div className="stat-chip">
              <span className="label">Wear</span>
              <span className="value" style={{ fontSize: 14, color: wearOf(data).pct >= 1 ? 'var(--danger)' : wearOf(data).pct >= 0.8 ? 'var(--warning)' : undefined }}>
                {Math.round(wearOf(data).pct * 100)}%
              </span>
            </div>
          )}
        </div>
        {data.notes && <div style={{ marginTop: 14, fontSize: 14, color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>{data.notes}</div>}
      </div>

      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
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
        <>
          <div className="overlay" onClick={() => setConfirmDelete(false)} />
          <div className="modal">
            <div className="modal-box" style={{ maxWidth: 420 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <AlertTriangle size={20} style={{ color: 'var(--warning)' }} />
                <h3 style={{ fontSize: 16, fontWeight: 700 }}>Delete equipment?</h3>
              </div>
              <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 20, lineHeight: 1.5 }}>
                {data.workoutCount > 0
                  ? `“${data.name}” is linked to ${data.workoutCount} ${data.workoutCount === 1 ? 'workout' : 'workouts'}. Deleting it will remove it from ${data.workoutCount === 1 ? 'that workout' : 'those workouts'}. This cannot be undone.`
                  : `“${data.name}” will be permanently deleted. This cannot be undone.`}
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>Cancel</button>
                <button className="btn btn-primary" style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => void doDelete()}>Delete</button>
              </div>
            </div>
          </div>
        </>
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
    ? { name: initial.name, type: initial.type, brand: initial.brand, model: initial.model, notes: initial.notes, retired: initial.retired, retireAtKm: initial.retireAtKm ?? 0 }
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
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal">
        <div className="modal-box" style={{ maxWidth: 480 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 700 }}>{initial ? 'Edit Equipment' : 'Add Equipment'}</h2>
              <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>Track gear like shoes, watches, and bikes</p>
            </div>
            <button className="btn-icon" onClick={onClose}><X size={16} /></button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Name</label>
              <input className="input" style={{ width: '100%' }} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Nike Pegasus 40" />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Type</label>
              <Dropdown
                value={form.type}
                options={FORM_TYPE_OPTIONS}
                onChange={v => setForm({ ...form, type: v })}
                block
                ariaLabel="Equipment type"
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Brand</label>
              <input className="input" style={{ width: '100%' }} value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} placeholder="e.g. Nike" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Model</label>
              <input className="input" style={{ width: '100%' }} value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="e.g. Air Zoom" />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Replace at (km)</label>
              <input
                className="input" type="number" min="0" style={{ width: '100%' }}
                value={form.retireAtKm || ''}
                onChange={e => setForm({ ...form, retireAtKm: Number(e.target.value) || 0 })}
                placeholder={String(DEFAULT_RETIRE_KM[form.type] ?? 0) === '0' ? 'n/a for this type' : String(DEFAULT_RETIRE_KM[form.type])}
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Notes (optional)</label>
              <textarea className="input" style={{ width: '100%', resize: 'vertical', minHeight: 60 }} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Purchase date, size, etc." />
            </div>
            <label style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', color: 'var(--text-2)' }}>
              <input type="checkbox" checked={form.retired} onChange={e => setForm({ ...form, retired: e.target.checked })} />
              Retired (no longer in use)
            </label>
          </div>

          {error && (
            <div style={{ marginTop: 16, color: 'var(--danger)', fontSize: 12 }}>{error}</div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
            <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </>
  )
}
