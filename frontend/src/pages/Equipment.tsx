import { useState, useEffect, useCallback, useMemo } from 'react'
import { LOCATION_EVENT } from '../App'
import {
  Plus, Watch, Bike, Shirt, Package, SportShoe, Pencil, Trash2, X, ChevronRight,
  ArrowLeft, AlertTriangle, SlidersHorizontal, ArrowUpDown, Layers,
  ArrowDownAZ, Activity, Route, Gauge, Shapes, Check,
} from 'lucide-react'
import { api, type Equipment, type EquipmentInput, type LinkedWorkout } from '../lib/api'
import { useRefreshHandler } from '../context/RefreshContext'
import { useWorkouts } from '../context/WorkoutsContext'
import { useIsMobile } from '../lib/useIsMobile'
import Dropdown, { type DropdownOption } from '../components/Dropdown'
import FilterSheet from '../components/FilterSheet'
import WorkoutCard from '../components/WorkoutCard'
import ConfirmDialog from '../components/ConfirmDialog'
import { searchWorkouts } from '../lib/workoutFilters'
import { fmtDist, type Workout } from '../data/workouts'
import Modal from '../components/Modal'
import SearchInput from '../components/SearchInput'

interface EquipmentPageProps {
  onSelectWorkout: (id: string) => void
  /**
   * The piece of gear currently open, or null for the inventory.
   *
   * Owned by the router rather than by this page, so that opening a workout
   * from a piece of gear — which unmounts this whole component — can be backed
   * out of onto the gear you left rather than onto the inventory.
   */
  detail: string | null
  onOpenDetail: (id: string | null) => void
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

/**
 * Marked by field rather than direction, unlike the workout list's sort. Every
 * option here is a different field and the label already carries the direction
 * ("Most used"), so an arrow would have been the same mark five times over —
 * which is what "A→Z", three identical arrows and a middot amounted to.
 */
const sortMark = (Icon: typeof Shapes) => <Icon size={14} color="var(--text-3)" aria-hidden />

const SORT_OPTIONS: DropdownOption<SortField>[] = [
  { value: 'name', label: 'By name', glyph: sortMark(ArrowDownAZ) },
  { value: 'workouts', label: 'Most used', glyph: sortMark(Activity) },
  { value: 'distance', label: 'Longest distance', glyph: sortMark(Route) },
  { value: 'wear', label: 'Most worn', glyph: sortMark(Gauge) },
  { value: 'type', label: 'By type', glyph: sortMark(Shapes) },
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

export default function EquipmentPage({ onSelectWorkout, detail, onOpenDetail }: EquipmentPageProps) {
  const [items, setItems] = useState<Equipment[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Equipment | 'new' | null>(null)
  /*
   * "Add equipment", asked for from somewhere else.
   *
   * The dashboard's button offers making a piece of gear but does not own the
   * form, the save or what happens after it — this page does. So it sends the
   * request in the URL and this picks it up, which means one creation flow
   * rather than two that drift.
   *
   * The flag is stripped as it is read, or a refresh would reopen the form,
   * and the location event covers the case where this page is already the one
   * on screen.
   */
  useEffect(() => {
    const take = () => {
      const url = new URL(window.location.href)
      if (url.searchParams.get('new') !== '1') return
      url.searchParams.delete('new')
      window.history.replaceState(window.history.state, '', url.pathname + url.search)
      setEditing('new')
    }
    take()
    window.addEventListener(LOCATION_EVENT, take)
    return () => window.removeEventListener(LOCATION_EVENT, take)
  }, [])

  /**
   * Incremented on every save, to tell an open detail view its row changed.
   *
   * The list and the detail each fetch the same row separately, and saving only
   * ever invalidated the list — so an edit made from the detail was not visible
   * until it was closed and reopened, which is what remounts it.
   */
  const [savedAt, setSavedAt] = useState(0)
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
          {/* Desktop only: on a phone the same action is the floating button,
              which is where the thumb already is. */}
          {!detail && (
            <button className="btn btn-primary desktop-only" onClick={() => setEditing('new')}>
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
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search equipment..."
            />

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
                  icon={<ArrowUpDown size={13} color="var(--text-3)" style={{ flexShrink: 0 }} />}
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
              options: SORT_OPTIONS.map(o => ({ value: o.value, label: o.label, glyph: o.glyph })),
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
            reloadToken={savedAt}
            onBack={() => { onOpenDetail(null); void load() }}
            onSelectWorkout={onSelectWorkout}
            onEdit={e => setEditing(e)}
            onDeleted={() => { onOpenDetail(null); void load() }}
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
              <div key={e.id} className="card" style={{ padding: 16, cursor: 'pointer', opacity: e.retired ? 0.6 : 1 }} onClick={() => onOpenDetail(e.id)}>
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
          onSaved={saved => {
            setEditing(null)
            setSavedAt(n => n + 1)
            void load()
            // A brand-new piece of gear opens on itself. Nothing is linked to
            // it yet, so the list row it would land in says nothing — and
            // adding gear is nearly always the first half of putting workouts
            // against it, which is what the detail view is for.
            if (editing === 'new' && saved) onOpenDetail(saved.id)
          }}
        />
      )}
    </div>
  )
}

/**
 * Picks workouts to link to a piece of equipment, by searching the library.
 *
 * The other direction of this already existed — open a workout, add its gear —
 * which is the right shape when you have just imported one run. It is the wrong
 * shape for a new pair of shoes you have already run twenty times in, where you
 * are thinking about the gear and the workouts are the list.
 *
 * Searching rather than scrolling because the library is the whole history: a
 * picker listing all of it is not something anyone reads. It runs against the
 * workouts already in memory, so it answers on the keystroke and works offline.
 *
 * A dialog rather than a panel inside the page: choosing workouts is a detour
 * with its own start and end, and opening it in place pushed the list you were
 * looking at down the page — so the thing you were about to compare against
 * moved the moment you went to change it.
 */
function LinkWorkoutsDialog({ equipmentId, linked, onLinked, onClose }: {
  equipmentId: string
  /** Already on this equipment, so the picker does not offer them again. */
  linked: ReadonlySet<string>
  onLinked: (updated: Equipment & { workouts: LinkedWorkout[] }) => void
  onClose: () => void
}) {
  const { workouts, refresh } = useWorkouts()
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Anything picked stays visible while the query moves on, so a selection
  // built across two or three searches can still be reviewed before saving —
  // and can be un-picked without retyping the search that found it.
  const results = useMemo(() => {
    const found = searchWorkouts(workouts, query, linked)
    const chosen = picked
      .map(id => workouts.find(w => w.id === id))
      .filter((w): w is Workout => !!w && !found.some(f => f.id === w.id))
    return [...chosen, ...found]
  }, [workouts, query, linked, picked])

  const toggle = (id: string) =>
    setPicked(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))

  async function save() {
    setSaving(true)
    setError(null)
    try {
      onLinked(await api.linkEquipmentWorkouts(equipmentId, picked))
      // Those workouts now carry this gear, and the cache behind every other
      // page still says they do not. Cheaper to reload the list once here than
      // to leave the workout page disagreeing with the one you just used.
      void refresh()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not link workouts')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose} dismissable={!saving} label="Add workouts">
        <div className="modal-box link-picker-box">
          <div className="dialog-head">
            <h3 style={{ fontSize: 16, fontWeight: 700 }}>Add workouts</h3>
            <button className="btn-icon" onClick={onClose} disabled={saving} aria-label="Close"><X size={16} /></button>
          </div>
          <div style={{ marginBottom: 10 }}>
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search workouts by name, sport or date…"
              label="Search workouts to link"
              grow={false}
              minWidth={0}
              autoFocus
            />
          </div>

        {error && <p style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 8 }}>{error}</p>}

        <div className="link-picker-list">
          {results.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-3)', padding: '10px 2px' }}>
              {workouts.length === 0
                ? 'No workouts yet.'
                : query
                  ? 'No workouts match that.'
                  : 'Every workout already uses this.'}
            </p>
          ) : results.map(w => {
            const on = picked.includes(w.id)
            return (
              <button
                key={w.id}
                type="button"
                className={`link-picker-row${on ? ' on' : ''}`}
                onClick={() => toggle(w.id)}
                aria-pressed={on}
              >
                <span className="link-picker-check">{on && <Check size={12} />}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="link-picker-name">{w.name}</span>
                  <span className="link-picker-meta">
                    {new Date(w.date).toLocaleDateString()} · {w.type} · {fmtDist(w.distance)}
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end', alignItems: 'center' }}>
          {picked.length > 0 && (
            <span style={{ fontSize: 12, color: 'var(--text-3)', marginRight: 'auto' }}>
              {picked.length} selected
            </span>
          )}
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => void save()} disabled={saving || picked.length === 0}>
            {saving ? 'Adding…' : `Add${picked.length > 0 ? ` ${picked.length}` : ''}`}
          </button>
          </div>
        </div>
    </Modal>
  )
}

function EquipmentDetail({ id, reloadToken, onBack, onSelectWorkout, onEdit, onDeleted }: {
  id: string
  /** Bumped by the page when an edit is saved; any change refetches. */
  reloadToken: number
  onBack: () => void
  onSelectWorkout: (id: string) => void
  onEdit: (e: Equipment) => void
  onDeleted: () => void
}) {
  const [data, setData] = useState<(Equipment & { workouts: LinkedWorkout[] }) | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [linking, setLinking] = useState(false)
  /** The workout the X was pressed on, awaiting confirmation. */
  const [unlinking, setUnlinking] = useState<LinkedWorkout | null>(null)
  const [unlinkBusy, setUnlinkBusy] = useState(false)
  const { refresh: refreshWorkouts } = useWorkouts()

  // What the picker must not offer again. Kept as a set because it is read once
  // per candidate row on every keystroke.
  const linkedIds = useMemo(() => new Set((data?.workouts ?? []).map(w => w.id)), [data])

  const load = useCallback(async () => {
    setData(await api.getEquipment(id))
  }, [id])

  // `reloadToken` changes when the editor saves. Without it this effect only
  // ran on a change of `id`, so editing the item already on screen left the
  // page showing what it fetched when it opened — the page reloaded the list
  // behind the detail, which is a different copy of the same row.
  useEffect(() => { void load() }, [load, reloadToken])

  // The detail owns its own fetch, so it has to opt into the pull-to-refresh
  // gesture separately from the list. Registering both is the point of the
  // context holding a set: with the detail open, a pull reloads both.
  useRefreshHandler(load)

  async function doDelete() {
    await api.deleteEquipment(id)
    onDeleted()
  }

  // The response carries the whole detail back, so the count and the wear
  // figures move with the list rather than a beat behind it.
  async function unlink(workoutID: string) {
    setUnlinkBusy(true)
    try {
      setData(await api.unlinkEquipmentWorkout(id, workoutID))
      void refreshWorkouts()
    } catch {
      // Nothing changed server-side; a refetch is the honest recovery.
      void load()
    } finally {
      setUnlinkBusy(false)
      setUnlinking(null)
    }
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

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600 }}>
          Linked workouts <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>({data.workouts.length})</span>
        </h2>
        <button className="btn btn-accent" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setLinking(true)}>
          <Plus size={14} /> Add workouts
        </button>
      </div>

      {data.workouts.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)' }}>No workouts use this equipment yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* The same row the workout list draws, with the X where the library
              puts its share control — a workout should not look like a
              different kind of thing depending on which page lists it. */}
          {data.workouts.map(w => (
            <WorkoutCard
              key={w.id}
              workout={w}
              variant="list"
              plain
              onClick={() => onSelectWorkout(w.id)}
              aside={
                <button
                  className="icon-btn"
                  title="Remove from this equipment"
                  aria-label={`Remove ${w.name} from this equipment`}
                  onClick={e => { e.stopPropagation(); setUnlinking(w) }}
                >
                  <X size={15} />
                </button>
              }
            />
          ))}
        </div>
      )}

      {linking && (
        <LinkWorkoutsDialog
          equipmentId={data.id}
          linked={linkedIds}
          onLinked={setData}
          onClose={() => setLinking(false)}
        />
      )}

      {/* The X sits on a row whose own click opens the workout, and it is one
          tap from a delete button on the card above — so it says out loud that
          this unlinks and does not remove anything. */}
      {unlinking && (
        <ConfirmDialog
          title="Remove from this equipment?"
          message={<>“{unlinking.name}” will no longer be linked to “{data.name}”. The workout itself is not deleted, and its other equipment is untouched.</>}
          confirmLabel="Remove"
          busy={unlinkBusy}
          busyLabel="Removing…"
          onCancel={() => setUnlinking(null)}
          onConfirm={() => void unlink(unlinking.id)}
        />
      )}

      {confirmDelete && (
        <Modal onClose={() => setConfirmDelete(false)}>
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
        </Modal>
      )}
    </div>
  )
}

function EquipmentForm({ initial, onClose, onSaved }: {
  initial: Equipment | null
  onClose: () => void
  /** Hands back what was saved, so a caller can open it. */
  onSaved: (saved?: Equipment) => void
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
      const saved = initial
        ? await api.patchEquipment(initial.id, form)
        : await api.createEquipment(form)
      onSaved(saved)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose}>
        <div className="modal-box" style={{ maxWidth: 480 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 700 }}>{initial ? 'Edit Equipment' : 'Add Equipment'}</h2>
              <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>Track gear like shoes, watches, and bikes</p>
            </div>
            <button className="btn-icon" onClick={onClose} aria-label="Close"><X size={16} /></button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="form-label">Name</label>
              <input className="input" style={{ width: '100%' }} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Nike Pegasus 40" />
            </div>
            <div>
              <label className="form-label">Type</label>
              <Dropdown
                value={form.type}
                options={FORM_TYPE_OPTIONS}
                onChange={v => setForm({ ...form, type: v })}
                block
                ariaLabel="Equipment type"
              />
            </div>
            <div>
              <label className="form-label">Brand</label>
              <input className="input" style={{ width: '100%' }} value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} placeholder="e.g. Nike" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="form-label">Model</label>
              <input className="input" style={{ width: '100%' }} value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="e.g. Air Zoom" />
            </div>
            <div>
              <label className="form-label">Replace at (km)</label>
              <input
                className="input" type="number" min="0" style={{ width: '100%' }}
                value={form.retireAtKm || ''}
                onChange={e => setForm({ ...form, retireAtKm: Number(e.target.value) || 0 })}
                placeholder={String(DEFAULT_RETIRE_KM[form.type] ?? 0) === '0' ? 'n/a for this type' : String(DEFAULT_RETIRE_KM[form.type])}
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="form-label">Notes (optional)</label>
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
    </Modal>
  )
}
