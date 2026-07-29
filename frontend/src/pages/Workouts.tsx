import { useState, useMemo, useEffect, useCallback } from 'react'
import { fmtDuration, fmtDist, fmtPace, TYPE_COLOR, TYPE_ICON, WORKOUT_TYPES, type WorkoutType, type Workout } from '../data/workouts'
import { useWorkouts } from '../context/WorkoutsContext'
import { Search, ChevronRight, Clock, Mountain, Flame, Download, Plus, RefreshCw, Grid2X2, List, Navigation, Library, Inbox, Globe, Users, Share2, SlidersHorizontal, X } from 'lucide-react'
import TypeDropdown from '../components/TypeDropdown'
import RangeDropdown from '../components/RangeDropdown'
import SortDropdown, { compareBySort, SORT_OPTIONS, type SortKey } from '../components/SortDropdown'
import FilterSheet, { type FilterGroup } from '../components/FilterSheet'
import ShareDialog from '../components/ShareDialog'
import UserAvatar, { userLabel } from '../components/UserAvatar'
import { filterByRange, RANGE_OPTIONS } from '../lib/range'
import { api } from '../lib/api'
import { downloadWorkoutGPX } from '../lib/download'
import { useIsMobile } from '../lib/useIsMobile'

interface WorkoutsProps {
  onSelect: (w: Workout) => void
  onImport: () => void
}

/**
 * Which library is on screen. "Mine" comes from WorkoutsContext, which is
 * shared with the dashboard and analytics and must stay owner-only; the other
 * two are fetched here and kept in local state so they never contaminate it.
 */
type Scope = 'mine' | 'shared' | 'public'

const SCOPES: { id: Scope; label: string; icon: React.ReactNode }[] = [
  { id: 'mine', label: 'My workouts', icon: <Library size={15} /> },
  { id: 'shared', label: 'Shared with me', icon: <Inbox size={15} /> },
  { id: 'public', label: 'Public', icon: <Globe size={15} /> },
]

export default function Workouts({ onSelect, onImport }: WorkoutsProps) {
  const { workouts, loading, refresh } = useWorkouts()
  const [scope, setScope] = useState<Scope>('mine')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<WorkoutType | 'All'>('All')
  const [sortBy, setSortBy] = useState<SortKey>('date-desc')
  const [rangeDays, setRangeDays] = useState(0)
  const [sharedOnly, setSharedOnly] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [sharing, setSharing] = useState<Workout | null>(null)
  const [feeds, setFeeds] = useState<Partial<Record<Scope, Workout[]>>>({})
  const [feedError, setFeedError] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const isMobile = useIsMobile()
  const [view, setView] = useState<'list' | 'grid'>(() => {
    const saved = localStorage.getItem('workouts.view')
    return saved === 'grid' || saved === 'list' ? saved : 'list'
  })

  function changeView(v: 'list' | 'grid') {
    setView(v)
    localStorage.setItem('workouts.view', v)
  }

  const loadFeed = useCallback(async (s: Scope) => {
    if (s === 'mine') return
    setFeedError(null)
    try {
      const rows = s === 'public' ? await api.feedPublic() : await api.feedShared()
      setFeeds(f => ({ ...f, [s]: rows }))
    } catch {
      setFeedError('Could not load these workouts.')
    }
  }, [])

  // Feeds load on first visit to their tab rather than on mount, so opening
  // Workouts costs the same as it always did.
  useEffect(() => {
    if (scope !== 'mine' && feeds[scope] === undefined) void loadFeed(scope)
  }, [scope, feeds, loadFeed])

  async function handleRefresh() {
    setRefreshing(true)
    try {
      await (scope === 'mine' ? refresh() : loadFeed(scope))
    } finally {
      setRefreshing(false)
    }
  }

  /**
   * The three filters, described once. Desktop renders them as dropdowns and
   * mobile as sheet groups, so neither surface can drift from the other.
   */
  const filterGroups: FilterGroup[] = [
    {
      key: 'type',
      label: 'Activity',
      value: typeFilter,
      onChange: v => setTypeFilter(v as WorkoutType | 'All'),
      options: [
        { value: 'All', label: 'All types' },
        ...WORKOUT_TYPES.map(t => ({ value: t, label: t, color: TYPE_COLOR[t] })),
      ],
    },
    {
      key: 'sort',
      label: 'Sort by',
      value: sortBy,
      onChange: v => setSortBy(v as SortKey),
      options: SORT_OPTIONS.map(o => ({ value: o.value, label: o.label })),
    },
    {
      key: 'range',
      label: 'Period',
      value: rangeDays,
      onChange: v => setRangeDays(v as number),
      options: RANGE_OPTIONS.map(o => ({ value: o.value, label: o.label })),
    },
  ]

  /** Only non-default filters count towards the badge and the chip row. */
  const activeFilters = [
    typeFilter !== 'All' && { key: 'type', label: typeFilter, clear: () => setTypeFilter('All') },
    rangeDays !== 0 && { key: 'range', label: RANGE_OPTIONS.find(o => o.value === rangeDays)?.label ?? '', clear: () => setRangeDays(0) },
    sortBy !== 'date-desc' && { key: 'sort', label: SORT_OPTIONS.find(o => o.value === sortBy)?.label ?? '', clear: () => setSortBy('date-desc') },
    // Sharing only filters your own library, so it never counts elsewhere.
    scope === 'mine' && sharedOnly && { key: 'shared', label: 'Shared only', clear: () => setSharedOnly(false) },
  ].filter(Boolean) as { key: string; label: string; clear: () => void }[]

  function resetFilters() {
    setTypeFilter('All')
    setSortBy('date-desc')
    setRangeDays(0)
    setSharedOnly(false)
  }

  const source = scope === 'mine' ? workouts : feeds[scope]
  const busy = source === undefined || (scope === 'mine' && loading)

  const filtered = useMemo(() => {
    let result = [...(source ?? [])]
    if (typeFilter !== 'All') result = result.filter(w => w.type === typeFilter)
    if (search) result = result.filter(w => w.name.toLowerCase().includes(search.toLowerCase()))
    if (scope === 'mine' && sharedOnly) {
      result = result.filter(w => w.visibility === 'public' || (w.sharedWithCount ?? 0) > 0)
    }
    result = filterByRange(result, rangeDays)
    result.sort(compareBySort(sortBy))
    return result
  }, [source, search, typeFilter, sortBy, rangeDays, scope, sharedOnly])

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 14 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>Workouts</h1>
          <span style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
            {filtered.length} of {source?.length ?? 0}
          </span>
          <button
            className="btn-icon"
            onClick={handleRefresh}
            disabled={refreshing || busy}
            title="Refresh"
            style={{ marginLeft: 'auto' }}
          >
            <RefreshCw size={15} className={refreshing || busy ? 'spin' : undefined} />
          </button>
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
            {([['list', <List key="l" size={15} />], ['grid', <Grid2X2 key="g" size={15} />]] as const).map(([id, icon]) => (
              <button
                key={id}
                onClick={() => changeView(id)}
                title={id === 'list' ? 'List view' : 'Grid view'}
                aria-pressed={view === id}
                style={{
                  display: 'flex', alignItems: 'center', padding: '6px 12px', border: 'none', cursor: 'pointer',
                  background: view === id ? 'var(--primary-dim)' : 'var(--bg-3)',
                  color: view === id ? 'var(--primary)' : 'var(--text-3)',
                }}
              >
                {icon}
              </button>
            ))}
          </div>
        </div>

        <nav className="tab-strip" style={{ marginBottom: 12 }} aria-label="Workout scope">
          {SCOPES.map(t => (
            <button
              key={t.id}
              className={`tab-strip-item${scope === t.id ? ' active' : ''}`}
              onClick={() => setScope(t.id)}
              aria-current={scope === t.id ? 'page' : undefined}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>

        {/* One filter row governs whichever scope is showing. Three 150px
            dropdowns wrap to three rows on a phone, so mobile collapses them
            into a sheet behind a single button. */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="workout-search" style={{ position: 'relative', flex: 1, minWidth: 180 }}>
            <Search size={14} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', pointerEvents: 'none' }} />
            <input
              className="input"
              placeholder="Search workouts..."
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
              <TypeDropdown value={typeFilter} onChange={v => setTypeFilter(v)} />
              <SortDropdown value={sortBy} onChange={setSortBy} />
              <RangeDropdown value={rangeDays} onChange={setRangeDays} />
              {scope === 'mine' && (
                <label className="switch" title="Show only workouts you have made public or shared">
                  <input type="checkbox" checked={sharedOnly} onChange={e => setSharedOnly(e.target.checked)} />
                  <span className="switch-track" />
                  Shared only
                </label>
              )}
            </>
          )}
        </div>

        {/* What is in effect stays visible without reopening the sheet. */}
        {isMobile && activeFilters.length > 0 && (
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

      <div className="page-content tight">
        {feedError ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-3)' }}>
            <p style={{ fontSize: 14 }}>{feedError}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-3)' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>{busy ? '⏳' : scope === 'mine' ? '🔍' : scope === 'public' ? '🌐' : '🤝'}</div>
            <p style={{ fontSize: 14 }}>{busy ? 'Loading workouts…' : emptyMessage(scope, sharedOnly)}</p>
          </div>
        ) : (
          <div className={view === 'grid' ? 'workout-grid' : 'workout-list'}>
            {filtered.map(w => (
              <WorkoutCard
                key={w.id}
                workout={w}
                variant={view}
                onClick={() => onSelect(w)}
                badge={scope === 'mine' ? <ShareBadge workout={w} /> : undefined}
                aside={scope === 'mine'
                  ? (
                    <>
                      <button
                        className="btn-icon"
                        title="Share"
                        onClick={e => { e.stopPropagation(); setSharing(w) }}
                        style={{ opacity: 0.6 }}
                      >
                        <Share2 size={15} />
                      </button>
                      <button
                        className="btn-icon card-export-btn"
                        title="Export as GPX"
                        onClick={e => { void exportWorkout(w, e) }}
                        style={{ opacity: 0.6 }}
                      >
                        <Download size={15} />
                      </button>
                    </>
                  )
                  : w.owner && (
                    <span className="owner-byline">
                      <UserAvatar user={w.owner} size={22} />
                      <span>{userLabel(w.owner)}</span>
                    </span>
                  )}
              />
            ))}
          </div>
        )}
      </div>

      {showFilters && (
        <FilterSheet
          groups={scope === 'mine'
            ? [...filterGroups, {
              key: 'shared',
              label: 'Sharing',
              value: sharedOnly,
              onChange: v => setSharedOnly(v as boolean),
              options: [{ value: false, label: 'All workouts' }, { value: true, label: 'Shared only' }],
            }]
            : filterGroups}
          onClose={() => setShowFilters(false)}
          onReset={activeFilters.length > 0 ? resetFilters : undefined}
        />
      )}

      {sharing && (
        <ShareDialog
          workoutId={sharing.id}
          workoutName={sharing.name}
          onClose={() => setSharing(null)}
          // The badges are driven by the library array, which WorkoutsContext
          // owns and the dashboard also reads — so re-fetch rather than patch
          // a local copy.
          onChange={() => { void refresh() }}
        />
      )}

      {/* Importing only makes sense in your own library. */}
      {scope === 'mine' && (
        <button className="fab" onClick={onImport} title="Add Workout" aria-label="Add workout">
          <Plus size={24} strokeWidth={2.5} />
        </button>
      )}
    </div>
  )
}

function emptyMessage(scope: Scope, sharedOnly: boolean): string {
  if (scope === 'shared') return 'Nobody has shared a workout with you yet'
  if (scope === 'public') return 'No public workouts on this instance yet'
  return sharedOnly ? 'You have not shared any workouts yet' : 'No workouts found'
}

/** Marks a workout you have made public or shared with someone. */
function ShareBadge({ workout: w }: { workout: Workout }) {
  const count = w.sharedWithCount ?? 0
  if (w.visibility !== 'public' && count === 0) return null
  return (
    <span
      className="share-badge"
      title={[
        w.visibility === 'public' ? 'Visible to everyone on this instance' : null,
        count > 0 ? `Shared with ${count} ${count === 1 ? 'person' : 'people'}` : null,
      ].filter(Boolean).join(' · ')}
    >
      {w.visibility === 'public' ? <Globe size={10} /> : <Users size={10} />}
      {count > 0 && count}
    </span>
  )
}

async function exportWorkout(w: Workout, e: React.MouseEvent) {
  e.stopPropagation()
  // The list view only carries summary fields (no route) for efficiency, so
  // fetch the full workout — including its route — on demand when exporting.
  downloadWorkoutGPX(await api.getWorkout(w.id))
}

interface WorkoutCardProps {
  workout: Workout
  variant: 'list' | 'grid'
  onClick: () => void
  /** Sharing indicator shown beside the type tag on your own workouts. */
  badge?: React.ReactNode
  /** Trailing control — the export button when you own it, the owner otherwise. */
  aside?: React.ReactNode
}

function WorkoutCard({ workout: w, variant, onClick, badge, aside }: WorkoutCardProps) {
  const color = TYPE_COLOR[w.type]
  const dateLabel = new Date(w.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  if (variant === 'grid') {
    return (
      <div
        onClick={onClick}
        style={{
          background: 'var(--bg-2)',
          border: '1px solid var(--border)',
          borderTop: `3px solid ${color}`,
          borderRadius: 12,
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          cursor: 'pointer',
          transition: 'all 0.15s',
          minWidth: 0,
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = `${color}40`; e.currentTarget.style.background = 'var(--bg-3)' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.borderTopColor = color; e.currentTarget.style.background = 'var(--bg-2)' }}
      >
        {/* Header: icon + type + name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10, flexShrink: 0,
            background: `${color}18`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
          }}>
            {TYPE_ICON[w.type]}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
              <span className={`badge tag-${w.type.toLowerCase()}`}>{w.type}</span>
              <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{dateLabel}</span>
              {badge}
            </div>
          </div>
        </div>

        {/* Primary metric */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, paddingBottom: 4, borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 24, fontWeight: 700, color }}>
            {w.avgPace ? fmtPace(w.avgPace) : w.avgSpeed.toFixed(1)}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>{w.avgPace ? '/km' : 'km/h'}</span>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', rowGap: 6, alignItems: 'center' }}>
          {w.distance > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <Navigation size={11} color="var(--text-3)" />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)' }}>{fmtDist(w.distance)}</span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <Clock size={11} color="var(--text-3)" />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)' }}>{fmtDuration(w.duration)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <Mountain size={11} color="var(--text-3)" />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)' }}>+{w.elevationGain}m</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <Flame size={11} color="var(--text-3)" />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)' }}>{w.calories} kcal</span>
          </div>
          <div style={{ marginLeft: 'auto' }}>{aside}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="workout-row" onClick={onClick} style={{ '--row-accent': color } as React.CSSProperties}>
      <div className="workout-row-icon">{TYPE_ICON[w.type]}</div>

      <div className="workout-row-body">
        <div className="workout-row-title">
          <span className="workout-row-name">{w.name}</span>
          <span className={`badge tag-${w.type.toLowerCase()}`}>{w.type}</span>
          {badge}
        </div>
        {/* Date and stats share a line on desktop; the mobile rule in index.css
            breaks the date onto its own line above them. */}
        <div className="workout-row-meta">
          <span className="workout-row-date">{dateLabel}</span>
          <div className="workout-row-stats">
            {w.distance > 0 && (
              <div className="workout-row-stat">
                <Navigation size={11} color="var(--text-3)" />
                <span>{fmtDist(w.distance)}</span>
              </div>
            )}
            <div className="workout-row-stat">
              <Clock size={11} color="var(--text-3)" />
              <span>{fmtDuration(w.duration)}</span>
            </div>
            <div className="workout-row-stat optional">
              <Mountain size={11} color="var(--text-3)" />
              <span>+{w.elevationGain}m</span>
            </div>
            <div className="workout-row-stat optional">
              <Flame size={11} color="var(--text-3)" />
              <span>{w.calories} kcal</span>
            </div>
          </div>
        </div>
      </div>

      <div className="workout-row-aside">
        <div className="workout-row-pace">
          <b>{w.avgPace ? fmtPace(w.avgPace) : `${w.avgSpeed.toFixed(1)}`}</b>
          <small>{w.avgPace ? '/km' : 'km/h'}</small>
        </div>
        {aside}
        <ChevronRight size={16} color="var(--text-3)" />
      </div>
    </div>
  )
}
