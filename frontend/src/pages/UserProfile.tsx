import { useCallback, useEffect, useMemo, useState } from 'react'
import { Globe, Handshake, Layers, LoaderCircle, Search, Send, SlidersHorizontal } from 'lucide-react'
import { api, ApiError, type UserProfileData } from '../lib/api'
import { ALL_WORKOUT_TYPES, type Workout, type WorkoutType } from '../data/workouts'
import { useRefreshHandler } from '../context/RefreshContext'
import { useIsMobile } from '../lib/useIsMobile'
import { applyWorkoutFilters, DEFAULT_FILTERS } from '../lib/workoutFilters'
import { useSessionState } from '../lib/useSessionState'
import PageHeader from '../components/PageHeader'
import TabStrip from '../components/TabStrip'
import TypeIcon from '../components/TypeIcon'
import UserAvatar, { userLabel } from '../components/UserAvatar'
import WorkoutCard from '../components/WorkoutCard'
import TypeDropdown from '../components/TypeDropdown'
import SortDropdown, { SORT_OPTIONS, type SortKey } from '../components/SortDropdown'
import RangeDropdown from '../components/RangeDropdown'
import FilterSheet, { type FilterGroup } from '../components/FilterSheet'
import { RANGE_OPTIONS } from '../lib/range'

/**
 * Which set of workouts is on screen.
 *
 * Three, because there are three distinct relationships between two people and
 * a workout, and collapsing any pair of them loses the thing you came to see:
 * what they sent you, what you sent them, and what they put out to everyone.
 */
type Tab = 'with-me' | 'with-them' | 'public'

/**
 * Another member of this instance, and the workouts you and they can see of
 * each other's.
 *
 * Nothing here is new access. "With me" and "Public" come from the same two
 * feeds the Shared and Public tabs render, and "With them" is the caller's own
 * library filtered by who they shared it with — so every row was already
 * visible to whoever is looking. It is a different arrangement of the same
 * permission, by person rather than by recency.
 *
 * Your own profile carries only the public tab: the other two are relations
 * between two people, and neither means anything pointed at yourself.
 */
export default function UserProfile({ id, onBack, onSelect }: {
  id: number
  onBack: () => void
  onSelect: (w: Workout) => void
}) {
  const [data, setData] = useState<UserProfileData | null>(null)
  const [err, setErr] = useState<string | null>(null)
  /**
   * Kept across unmounts, because opening a workout from here replaces this
   * page: the tab you were reading was gone by the time you pressed back, and
   * every workout you looked at cost you the tab again. Per session, not
   * forever — which tab you were on is part of what you are doing now.
   */
  const [{ tab }, setTabState] = useSessionState<{ tab: Tab }>('al_profile_tab', { tab: 'with-me' })
  const setTab = useCallback((t: Tab) => setTabState({ tab: t }), [setTabState])
  const isMobile = useIsMobile()

  // The same controls the library uses, so a list of workouts is filtered the
  // same way wherever you meet one.
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<WorkoutType | 'All'>('All')
  const [sortBy, setSortBy] = useState<SortKey>('date-desc')
  const [rangeDays, setRangeDays] = useState(0)
  const [showFilters, setShowFilters] = useState(false)

  const load = useCallback(async () => {
    try {
      const d = await api.getUserProfile(id)
      setData(d)
      // Your own profile has only one tab, and a remembered "with me" would
      // land on a tab this page does not offer. Anything else is left alone, so
      // a refresh — or coming back from a workout — keeps the tab you chose.
      if (d.self) setTab('public')
      setErr(null)
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not load this profile')
    }
  }, [id, setTab])
  useEffect(() => { void load() }, [load])
  useRefreshHandler(load)

  const rows = useMemo(() => {
    if (!data) return []
    // Three named lists from the server rather than one merged one to slice
    // apart: which rows are which is the server's answer to give.
    const source = tab === 'with-them'
      ? data.sharedWithThem
      : tab === 'public'
        ? data.publicWorkouts
        : data.sharedWithMe
    return applyWorkoutFilters(source, {
      ...DEFAULT_FILTERS,
      scope: tab === 'with-them' ? 'mine' : 'shared',
      search,
      typeFilter,
      sortBy,
      rangeDays,
    })
  }, [data, tab, search, typeFilter, sortBy, rangeDays])

  const activeFilters = useMemo(() => {
    const out: { key: string; label: string; clear: () => void }[] = []
    if (typeFilter !== 'All') out.push({ key: 'type', label: typeFilter, clear: () => setTypeFilter('All') })
    if (rangeDays !== 0) {
      out.push({
        key: 'range',
        label: RANGE_OPTIONS.find(o => o.value === rangeDays)?.label ?? `${rangeDays}d`,
        clear: () => setRangeDays(0),
      })
    }
    if (sortBy !== 'date-desc') out.push({ key: 'sort', label: 'Sorted', clear: () => setSortBy('date-desc') })
    return out
  }, [typeFilter, rangeDays, sortBy])

  // The same three groups the library's sheet offers, in the same order, so
  // the phone filter is one control learned once.
  const filterGroups: FilterGroup[] = [
    {
      key: 'type',
      label: 'Activity',
      value: typeFilter,
      onChange: v => setTypeFilter(v as WorkoutType | 'All'),
      options: [
        { value: 'All', label: 'All types', glyph: <Layers size={13} color="var(--text-3)" aria-hidden /> },
        ...ALL_WORKOUT_TYPES.map(t => ({ value: t, label: t, glyph: <TypeIcon type={t} size={13} /> })),
      ],
    },
    {
      key: 'sort',
      label: 'Sort by',
      value: sortBy,
      onChange: v => setSortBy(v as SortKey),
      options: SORT_OPTIONS.map(o => ({ value: o.value, label: o.label, glyph: o.glyph })),
    },
    {
      key: 'range',
      label: 'Period',
      value: rangeDays,
      onChange: v => setRangeDays(v as number),
      options: RANGE_OPTIONS.map(o => ({ value: o.value, label: o.label })),
    },
  ]

  if (err) {
    return (
      <>
        <PageHeader title="Profile" onBack={onBack} />
        <div className="page-content settings-page">
          <div className="settings-card danger"><span className="status-msg err">{err}</span></div>
        </div>
      </>
    )
  }
  if (!data) {
    return (
      <>
        <PageHeader title="Profile" onBack={onBack} />
        <div className="detail-loading"><LoaderCircle size={18} className="spin" /></div>
      </>
    )
  }

  const name = userLabel(data.user)
  const tabs = data.self
    ? [{ id: 'public' as Tab, label: 'Public', icon: <Globe size={14} /> }]
    : [
      { id: 'with-me' as Tab, label: 'With me', icon: <Handshake size={14} /> },
      { id: 'with-them' as Tab, label: 'With them', icon: <Send size={14} /> },
      { id: 'public' as Tab, label: 'Public', icon: <Globe size={14} /> },
    ]

  const empty = tab === 'with-them'
    ? `You have not shared anything with ${name}.`
    : tab === 'public'
      ? data.self ? 'You have not made any workout public.' : `${name} has no public workouts.`
      : `${name} has not shared anything with you.`

  return (
    <>
      {/* "User", not the name: the name is the headline directly below, and
          the bar repeating it printed the same fact twice. */}
      <PageHeader title={data.self ? 'Profile' : 'User'} onBack={onBack} />
      <div className="page-content">
        <div className="profile-head">
          <UserAvatar user={data.user} size={64} />
          <div style={{ minWidth: 0 }}>
            <div className="profile-name">{name}</div>
            {/* Only when it says something the name did not — a display name of
                "alice" over a username of "alice" is one fact printed twice. */}
            {data.user.displayName && data.user.displayName !== data.user.username && (
              <div className="profile-handle">@{data.user.username}</div>
            )}
            {data.tagline && <p className="profile-tagline">{data.tagline}</p>}
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <TabStrip items={tabs} value={tab} onChange={setTab} ariaLabel="Which workouts" fill />
        </div>

        <div className="profile-tools">
          <div style={{ position: 'relative', flex: 1, minWidth: 160 }}>
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
            </>
          )}
        </div>

        {isMobile && activeFilters.length > 0 && (
          <div className="filter-chips">
            {activeFilters.map(f => (
              <button key={f.key} className="filter-chip" onClick={f.clear}>
                {f.label} <span aria-hidden>×</span>
              </button>
            ))}
          </div>
        )}

        {rows.length === 0 ? (
          <div className="card" style={{ padding: 28, textAlign: 'center', color: 'var(--text-3)', marginTop: 12 }}>
            {search || activeFilters.length > 0 ? 'No workouts match that.' : empty}
          </div>
        ) : (
          <div className="workout-list" style={{ marginTop: 12 }}>
            {/* The same row the library draws, so a workout looks like a
                workout wherever you meet it. */}
            {rows.map(w => (
              <WorkoutCard key={w.id} workout={w} variant="list" onClick={() => onSelect(w)} />
            ))}
          </div>
        )}
      </div>

      {showFilters && (
        <FilterSheet
          groups={filterGroups}
          onClose={() => setShowFilters(false)}
          onReset={() => { setTypeFilter('All'); setSortBy('date-desc'); setRangeDays(0) }}
        />
      )}
    </>
  )
}
