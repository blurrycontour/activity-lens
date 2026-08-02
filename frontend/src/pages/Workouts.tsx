import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { fmtDuration, fmtDist, fmtPace, TYPE_COLOR, WORKOUT_TYPES, type WorkoutType, type Workout } from '../data/workouts'
import TypeIcon from '../components/TypeIcon'
import { useWorkouts } from '../context/WorkoutsContext'
import { useRefreshHandler } from '../context/RefreshContext'
import { Search, Clock, Mountain, Flame, Download, Plus, Grid2X2, List, Navigation, Library, Inbox, Globe, Users, Share2, SlidersHorizontal, X, Trash2, Check, LoaderCircle, Handshake, Layers } from 'lucide-react'
import TypeDropdown from '../components/TypeDropdown'
import RangeDropdown from '../components/RangeDropdown'
import SortDropdown, { SORT_OPTIONS, type SortKey } from '../components/SortDropdown'
import FilterSheet, { type FilterGroup } from '../components/FilterSheet'
import ShareDialog from '../components/ShareDialog'
import UserAvatar, { userLabel } from '../components/UserAvatar'
import SourceMark from '../components/SourceMark'
import ConfirmDialog from '../components/ConfirmDialog'
import { useLongPress } from '../lib/useLongPress'
import { RANGE_OPTIONS } from '../lib/range'
import { api } from '../lib/api'
import { downloadWorkoutGPX, reportSaveFailure } from '../lib/download'
import { useIsMobile } from '../lib/useIsMobile'
import { LOCATION_EVENT } from '../App'
import { useSessionState } from '../lib/useSessionState'
import {
  applyWorkoutFilters, DEFAULT_FILTERS, describeImportWindow, parseAutoImportParams,
  type Scope, type WorkoutFilters,
} from '../lib/workoutFilters'

const FILTERS_KEY = 'workouts.filters'

interface WorkoutsProps {
  onSelect: (w: Workout) => void
  onImport: () => void
}

/*
 * Scope — which library is on screen — is defined with the filters it belongs
 * to. "Mine" comes from WorkoutsContext, which is shared with the dashboard and
 * analytics and must stay owner-only; the other two are fetched here and kept in
 * local state so they never contaminate it.
 */
const SCOPES: { id: Scope; label: string; icon: React.ReactNode }[] = [
  { id: 'mine', label: 'My workouts', icon: <Library size={15} /> },
  { id: 'shared', label: 'Shared with me', icon: <Inbox size={15} /> },
  { id: 'public', label: 'Public', icon: <Globe size={15} /> },
]

export default function Workouts({ onSelect, onImport }: WorkoutsProps) {
  const { workouts, loading, refresh } = useWorkouts()
  // Opening a workout unmounts this page, so every filter lived exactly as long
  // as it took to look at one result and come back. Kept in sessionStorage
  // rather than component state: it survives the round trip and a reload, and
  // still starts clean in a new session, which is what someone expects of a
  // search box they typed into an hour ago.
  const [filters, setFilters] = useSessionState<WorkoutFilters>(FILTERS_KEY, DEFAULT_FILTERS)
  const { scope, search, typeFilter, sortBy, rangeDays, sharedOnly, originFilter, since } = filters
  const patch = useCallback(
    (next: Partial<WorkoutFilters>) => setFilters(prev => ({ ...prev, ...next })),
    [setFilters],
  )
  const setScope = (v: Scope) => patch({ scope: v })
  const setSearch = (v: string) => patch({ search: v })
  const setTypeFilter = (v: WorkoutType | 'All') => patch({ typeFilter: v })
  const setSortBy = (v: SortKey) => patch({ sortBy: v })
  const setRangeDays = (v: number) => patch({ rangeDays: v })
  const setSharedOnly = (v: boolean) => patch({ sharedOnly: v })
  const [sharing, setSharing] = useState<Workout | null>(null)
  const [feeds, setFeeds] = useState<Partial<Record<Scope, Workout[]>>>({})
  const [feedError, setFeedError] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  /**
   * Bulk selection, entered by pressing and holding a workout.
   *
   * null rather than an empty set, so "not selecting" and "selecting nothing"
   * stay distinct: the second is a real state the user can reach by deselecting
   * their last row, and the toolbar has to stay up when they do.
   *
   * Your own library only. The other two tabs are other people's workouts, and
   * there is nothing to bulk do to them.
   */
  const [selected, setSelected] = useState<Set<string> | null>(null)
  // Whether a history entry is standing in for the selection, so Android's back
  // gesture — and the browser's back button — cancel it rather than leaving the
  // page. Tracked in a ref because the popstate listener would otherwise close
  // over a stale copy.
  const selectionEntry = useRef(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const selecting = selected !== null && scope === 'mine'
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

  // Claims a ?source= filter from the URL, on mount and whenever a link lands
  // here while this page is already showing.
  useEffect(() => {
    const claim = () => {
      const claimed = parseAutoImportParams(window.location.search)
      if (!claimed) return
      // Auto-imported workouts are always your own.
      patch({ ...claimed, scope: 'mine' })
      // The library was loaded before these existed — the app was closed when
      // they arrived — so without this the filtered list is empty until the user
      // thinks to pull down.
      void refresh()
      // Taken out of the URL once applied: it is a one-shot handoff, and leaving
      // it would re-apply the filter on every reload after the user cleared it.
      const params = new URLSearchParams(window.location.search)
      params.delete('source')
      params.delete('since')
      params.delete('until')
      const query = params.toString()
      window.history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''))
    }
    claim()
    window.addEventListener(LOCATION_EVENT, claim)
    return () => window.removeEventListener(LOCATION_EVENT, claim)
  }, [patch, refresh])

  // Feeds load on first visit to their tab rather than on mount, so opening
  // Workouts costs the same as it always did.
  useEffect(() => {
    if (scope !== 'mine' && feeds[scope] === undefined) void loadFeed(scope)
  }, [scope, feeds, loadFeed])

  // Pull-to-refresh reloads whatever tab is showing. WorkoutsContext already
  // registers the owned library, so this only has to cover the feeds.
  useRefreshHandler(useCallback(
    () => (scope === 'mine' ? Promise.resolve() : loadFeed(scope)),
    [scope, loadFeed],
  ))

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
        { value: 'All', label: 'All types', glyph: <Layers size={13} color="var(--text-3)" aria-hidden /> },
        ...WORKOUT_TYPES.map(t => ({ value: t, label: t, glyph: <TypeIcon type={t} size={13} /> })),
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
    originFilter === 'autoimport' && {
      key: 'origin',
      label: describeImportWindow(since),
      clear: () => patch({ originFilter: null, since: null, until: null }),
    },
  ].filter(Boolean) as { key: string; label: string; clear: () => void }[]

  function resetFilters() {
    setTypeFilter('All')
    setSortBy('date-desc')
    setRangeDays(0)
    setFilters({ ...DEFAULT_FILTERS, scope })
  }

  /**
   * Enters selection mode, and puts a history entry in front of the page.
   *
   * Back is how you leave a mode on Android: the phone's gesture, the button,
   * and the browser's own back should all mean "never mind" here rather than
   * "leave the workouts page". A pushed entry is what turns one into the other,
   * and it is the same trick a dialog uses.
   */
  const startSelecting = useCallback((id: string) => {
    setSelected(prev => new Set(prev ?? []).add(id))
    if (selectionEntry.current) return
    selectionEntry.current = true
    window.history.pushState({ selecting: true }, '', window.location.href)
  }, [])

  /**
   * Leaves selection mode.
   *
   * @param popped true when back is what ended it, in which case the entry is
   *               already gone and going back again would leave the page.
   */
  const stopSelecting = useCallback((popped = false) => {
    setSelected(null)
    const hadEntry = selectionEntry.current
    selectionEntry.current = false
    if (hadEntry && !popped) window.history.back()
  }, [])

  useEffect(() => {
    const onPop = () => {
      // The entry being popped is ours only while a selection is up; otherwise
      // this is ordinary navigation and none of our business.
      if (selectionEntry.current) stopSelecting(true)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [stopSelecting])

  // A selection is a set of ids from one library; carrying it to another tab
  // would leave the toolbar counting rows that are no longer on screen.
  useEffect(() => { stopSelecting() }, [scope, stopSelecting])

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev ?? [])
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /**
   * Deletes everything selected.
   *
   * One request per workout: there is no bulk endpoint, and adding one to save a
   * handful of round trips would mean a second delete path to keep in step with
   * the first — which owns cascading shares, equipment links and the archived
   * upload. Failures are counted rather than thrown, so one workout that will
   * not delete does not strand the other nine.
   */
  async function deleteSelected() {
    const ids = [...(selected ?? [])]
    setDeleting(true)
    let failed = 0
    for (const id of ids) {
      try {
        await api.deleteWorkout(id)
      } catch {
        failed++
      }
    }
    await refresh()
    setDeleting(false)
    setConfirmDelete(false)
    stopSelecting()
    if (failed > 0) setFeedError(`${failed} of ${ids.length} could not be deleted.`)
  }

  const source = scope === 'mine' ? workouts : feeds[scope]
  const busy = source === undefined || (scope === 'mine' && loading)

  const filtered = useMemo(
    () => applyWorkoutFilters(source ?? [], filters),
    [source, filters],
  )

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 14 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>Workouts</h1>
          <span style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
            {filtered.length} of {source?.length ?? 0}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
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

        {/* While selecting, the toolbar takes the filter row's place rather than
            adding a second bar: the two are never useful at once, and pushing the
            list down a row on a phone would cost more than it gives. */}
        {selecting ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn-icon" onClick={() => stopSelecting()} aria-label="Cancel selection">
              <X size={16} />
            </button>
            <span style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
              {selected?.size ?? 0} selected
            </span>
            <button
              className="btn btn-ghost"
              style={{ marginLeft: 'auto', color: 'var(--danger)' }}
              disabled={(selected?.size ?? 0) === 0}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={15} /> Delete
            </button>
          </div>
        ) : (
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
        )}

        {/* What is in effect stays visible without reopening the sheet. */}
        {!selecting && isMobile && activeFilters.length > 0 && (
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
            <EmptyScopeIcon busy={busy} scope={scope} />
            <p style={{ fontSize: 14 }}>{busy ? 'Loading workouts…' : emptyMessage(scope, sharedOnly)}</p>
          </div>
        ) : (
          <div className={view === 'grid' ? 'workout-grid' : 'workout-list'}>
            {filtered.map(w => (
              <WorkoutCard
                key={w.id}
                workout={w}
                variant={view}
                selectable={scope === 'mine'}
                selected={selected?.has(w.id) ?? false}
                selecting={selecting}
                onLongPress={() => startSelecting(w.id)}
                onClick={() => (selecting ? toggle(w.id) : onSelect(w))}
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
                  : undefined}
                // Owner names can be long, so they get their own row rather
                // than competing with the pace figure for the trailing cluster.
                footer={scope !== 'mine' && w.owner
                  ? (
                    <span className="owner-byline">
                      <UserAvatar user={w.owner} size={18} />
                      <span>{userLabel(w.owner)}</span>
                    </span>
                  )
                  : undefined}
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
          workout={sharing}
          onClose={() => setSharing(null)}
          // The badges are driven by the library array, which WorkoutsContext
          // owns and the dashboard also reads — so re-fetch rather than patch
          // a local copy.
          onChange={() => { void refresh() }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${selected?.size ?? 0} workout${(selected?.size ?? 0) === 1 ? '' : 's'}?`}
          message="This cannot be undone. Their shares and equipment links go with them."
          confirmLabel="Delete"
          danger
          busy={deleting}
          busyLabel="Deleting…"
          onConfirm={() => void deleteSelected()}
          onCancel={() => setConfirmDelete(false)}
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

/**
 * The tick on a row while selecting.
 *
 * The opposite corner to the auto-import mark, which shares this icon: the two
 * were drawn on top of each other, and hiding one to show the other meant a row
 * silently changed what it was telling you the moment a selection began.
 */
function SelectionMark({ selected }: { selected: boolean }) {
  return (
    <span
      className={`selection-mark${selected ? ' on' : ''}`}
      aria-hidden
    >
      {selected ? <Check size={10} strokeWidth={3} /> : null}
    </span>
  )
}

function emptyMessage(scope: Scope, sharedOnly: boolean): string {
  if (scope === 'shared') return 'Nobody has shared a workout with you yet'
  if (scope === 'public') return 'No public workouts on this instance yet'
  return sharedOnly ? 'You have not shared any workouts yet' : 'No workouts found'
}

/**
 * The mark above an empty list, matching whichever tab is empty — so "nothing
 * shared with you" and "nothing matched your filter" do not look like the same
 * outcome. Pairs with `emptyMessage`, which is why they sit together.
 */
function EmptyScopeIcon({ busy, scope }: { busy: boolean; scope: Scope }) {
  const Icon = busy ? LoaderCircle : scope === 'public' ? Globe : scope === 'shared' ? Handshake : Search
  return (
    <Icon
      size={32}
      strokeWidth={1.5}
      className={busy ? 'spin' : undefined}
      style={{ margin: '0 auto 12px' }}
      aria-hidden
    />
  )
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
  try {
    await downloadWorkoutGPX(await api.getWorkout(w.id))
  } catch (err) {
    reportSaveFailure(err)
  }
}

interface WorkoutCardProps {
  workout: Workout
  variant: 'list' | 'grid'
  onClick: () => void
  /** Whether press-and-hold does anything here. Your own library only. */
  selectable?: boolean
  /** Whether the page is in selection mode, which changes what a click means. */
  selecting?: boolean
  selected?: boolean
  onLongPress?: () => void
  /** Sharing indicator shown beside the type tag on your own workouts. */
  badge?: React.ReactNode
  /** Trailing controls, shown beside the pace figure. */
  aside?: React.ReactNode
  /** Full-width row at the bottom of the card, used for the author byline. */
  footer?: React.ReactNode
}

function WorkoutCard({
  workout: w, variant, onClick, badge, aside, footer,
  selectable = false, selecting = false, selected = false, onLongPress,
}: WorkoutCardProps) {
  const color = TYPE_COLOR[w.type]
  const press = useLongPress(() => onLongPress?.())
  // The click that ends a long press must not also open the workout.
  const handleClick = () => { if (!press.consumedClick()) onClick() }
  const pressProps = selectable ? press.handlers : {}
  const selectionStyle: React.CSSProperties = selected
    ? { outline: '2px solid var(--primary)', outlineOffset: -2 }
    : {}
  const dateLabel = new Date(w.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  if (variant === 'grid') {
    return (
      <div
        onClick={handleClick}
        {...pressProps}
        style={{
          ...selectionStyle,
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
            position: 'relative',
          }}>
            <TypeIcon type={w.type} />
            <SourceMark source={w.source} />
            {selecting && <SelectionMark selected={selected} />}
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
        {footer && <div className="workout-card-footer">{footer}</div>}
      </div>
    )
  }

  return (
    <div
      className="workout-row"
      onClick={handleClick}
      {...pressProps}
      style={{ '--row-accent': color, ...selectionStyle } as React.CSSProperties}
    >
      <div className="workout-row-icon">
        <TypeIcon type={w.type} />
        <SourceMark source={w.source} />
        {selecting && <SelectionMark selected={selected} />}
      </div>

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
        {footer && <div className="workout-row-footer">{footer}</div>}
      </div>

      <div className="workout-row-aside">
        <div className="workout-row-pace">
          <b>{w.avgPace ? fmtPace(w.avgPace) : `${w.avgSpeed.toFixed(1)}`}</b>
          <small>{w.avgPace ? '/km' : 'km/h'}</small>
        </div>
        {aside}
      </div>
    </div>
  )
}
