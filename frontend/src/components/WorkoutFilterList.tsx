import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Handshake, Layers, LoaderCircle, Search, Send, SlidersHorizontal, X } from 'lucide-react'
import { ALL_WORKOUT_TYPES, type Workout, type WorkoutType } from '../data/workouts'
import { applyWorkoutFilters, DEFAULT_FILTERS, type Has, type Scope } from '../lib/workoutFilters'
import { RANGE_OPTIONS } from '../lib/range'
import { useIsMobile } from '../lib/useIsMobile'
import { useSessionState } from '../lib/useSessionState'
import ContainsDropdown, { containsLabel, containsOptions } from './ContainsDropdown'
import FilterSheet, { type FilterGroup } from './FilterSheet'
import RangeDropdown from './RangeDropdown'
import SortDropdown, { SORT_OPTIONS, type SortKey } from './SortDropdown'
import TypeDropdown from './TypeDropdown'
import TypeIcon from './TypeIcon'
import UserAvatar, { userLabel } from './UserAvatar'
import WorkoutCard from './WorkoutCard'

/** Rendered per page, and how many more each time the end comes into view. */
const PAGE_SIZE = 20

/** What this list narrows by, on its own so it can be stored as one value. */
interface Narrowing {
  search: string
  typeFilter: WorkoutType | 'All'
  sortBy: SortKey
  rangeDays: number
  has: Has[]
}

const NONE: Narrowing = {
  search: '',
  typeFilter: 'All',
  sortBy: DEFAULT_FILTERS.sortBy,
  rangeDays: 0,
  has: [],
}

/**
 * How many recipients are named before the rest become a count.
 *
 * Three fits the row at phone widths; past that the names stop being read and
 * start being a wall, and "and 4 more" is the more useful fact anyway.
 */
const NAMED_RECIPIENTS = 3

interface Props {
  /** The workouts to show, or undefined while they are still coming. */
  rows: Workout[] | undefined
  /** Which library these came from; only "mine" honours the sharing filter. */
  scope: Scope
  /**
   * Where this list's search and filters are remembered, per session. Distinct
   * per list, so the People feed and one person's profile do not share a search.
   */
  storageKey: string
  /** What to say when there is nothing, before any filter is applied. */
  emptyMessage: string
  /** A load that failed, shown in place of the list. */
  error?: string | null
  onSelect: (w: Workout) => void
  /**
   * The row under each card, if any.
   *
   * 'owner' names who recorded it, for a feed of other people's workouts.
   * 'recipients' names who you sent it to, which only your own workouts can
   * answer. Neither, by default: on one person's profile every row is already
   * theirs, and a byline repeating the name at the top of the page is noise.
   */
  byline?: 'owner' | 'recipients'
  /**
   * Whether these are the caller's own workouts. Only that unlocks the notes
   * filter — notes are redacted on everyone else's — and it is the same flag
   * the sharing filter reads.
   */
  mine?: boolean
  /** Opens a person named in the byline. */
  onOpenUser?: (id: number) => void
}

/**
 * A searchable, filterable list of workouts.
 *
 * Extracted because the same list is now in three places — the two feeds on
 * Discover and each tab of a profile — and it had already been copied twice by
 * hand, which is how "the same filters everywhere" quietly stops being true.
 * The library keeps its own copy: it carries selection, sharing, export and
 * paging state that none of these need, and folding those in here would make
 * this the more complicated thing rather than the shared one.
 */
export default function WorkoutFilterList({
  rows, scope, storageKey, emptyMessage, error, onSelect, byline, mine = false, onOpenUser,
}: Props) {
  const isMobile = useIsMobile()
  // Opening a workout unmounts this, so a search typed here would otherwise be
  // gone by the time the reader pressed back. Same lifetime as the library's.
  const [narrow, setNarrow] = useSessionState<Narrowing>(storageKey, NONE)
  const { search, typeFilter, sortBy, rangeDays, has } = narrow
  /** Adds or removes one attribute; they narrow together. */
  const toggleHas = (v: Has) => patch({ has: has.includes(v) ? has.filter(h => h !== v) : [...has, v] })
  const [showFilters, setShowFilters] = useState(false)
  const [shown, setShown] = useState(PAGE_SIZE)

  const patch = useCallback((next: Partial<Narrowing>) => {
    // One funnel, so this is the only place that has to put the list back to
    // the first page when what it shows changes.
    setShown(PAGE_SIZE)
    setNarrow(prev => ({ ...prev, ...next }))
  }, [setNarrow])

  const filtered = useMemo(
    () => applyWorkoutFilters(rows ?? [], { ...DEFAULT_FILTERS, ...narrow, scope }),
    [rows, narrow, scope],
  )
  const visible = useMemo(() => filtered.slice(0, shown), [filtered, shown])
  const hasMore = filtered.length > visible.length

  // A fresh observer reports the current intersection immediately, so a page
  // that lands entirely above the fold keeps loading until the end is below it.
  const endOfList = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = endOfList.current
    if (!el || !hasMore) return
    const io = new IntersectionObserver(
      entries => { if (entries.some(e => e.isIntersecting)) setShown(s => s + PAGE_SIZE) },
      { rootMargin: '300px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, shown])

  const groups: FilterGroup[] = [
    {
      key: 'type',
      label: 'Activity',
      value: typeFilter,
      onChange: v => patch({ typeFilter: v as WorkoutType | 'All' }),
      options: [
        { value: 'All', label: 'All types', glyph: <Layers size={13} color="var(--text-3)" aria-hidden /> },
        ...ALL_WORKOUT_TYPES.map(t => ({ value: t, label: t, glyph: <TypeIcon type={t} size={13} /> })),
      ],
    },
    {
      key: 'sort',
      label: 'Sort by',
      value: sortBy,
      onChange: v => patch({ sortBy: v as SortKey }),
      options: SORT_OPTIONS.map(o => ({ value: o.value, label: o.label, glyph: o.glyph })),
    },
    {
      key: 'range',
      label: 'Period',
      value: rangeDays,
      onChange: v => patch({ rangeDays: v as number }),
      options: RANGE_OPTIONS.map(o => ({ value: o.value, label: o.label })),
    },
    {
      key: 'has',
      label: 'Contains',
      multi: true,
      value: has,
      onChange: v => toggleHas(v as Has),
      options: containsOptions(mine).map(o => ({ value: o.value, label: o.label, glyph: o.glyph })),
    },
  ]

  const active = [
    typeFilter !== 'All' && { key: 'type', label: typeFilter, clear: () => patch({ typeFilter: 'All' }) },
    rangeDays !== 0 && {
      key: 'range',
      label: RANGE_OPTIONS.find(o => o.value === rangeDays)?.label ?? `${rangeDays}d`,
      clear: () => patch({ rangeDays: 0 }),
    },
    sortBy !== NONE.sortBy && {
      key: 'sort',
      label: SORT_OPTIONS.find(o => o.value === sortBy)?.label ?? 'Sorted',
      clear: () => patch({ sortBy: NONE.sortBy }),
    },
    ...has.map(h => ({ key: `has-${h}`, label: containsLabel(h), clear: () => toggleHas(h) })),
  ].filter(Boolean) as { key: string; label: string; clear: () => void }[]

  return (
    <>
      <div className="profile-tools">
        <div style={{ position: 'relative', flex: 1, minWidth: 160 }}>
          <Search size={14} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', pointerEvents: 'none' }} />
          <input
            className="input"
            placeholder="Search workouts..."
            value={search}
            onChange={e => patch({ search: e.target.value })}
            style={{ paddingLeft: 30, width: '100%' }}
          />
        </div>
        {isMobile ? (
          <button
            className="btn btn-ghost filter-btn"
            onClick={() => setShowFilters(true)}
            aria-label={`Filters${active.length ? `, ${active.length} applied` : ''}`}
          >
            <SlidersHorizontal size={15} />
            {active.length > 0 && <span className="filter-count">{active.length}</span>}
          </button>
        ) : (
          <>
            <TypeDropdown value={typeFilter} onChange={v => patch({ typeFilter: v })} />
            <SortDropdown value={sortBy} onChange={v => patch({ sortBy: v })} />
            <RangeDropdown value={rangeDays} onChange={v => patch({ rangeDays: v })} />
            <ContainsDropdown value={has} onToggle={toggleHas} mine={mine} />
          </>
        )}
      </div>

      {/* What is in effect stays visible without reopening the sheet. */}
      {isMobile && active.length > 0 && (
        <div className="active-filters">
          {active.map(f => (
            <span key={f.key} className="active-filter">
              {f.label}
              <button onClick={f.clear} aria-label={`Clear ${f.label}`}><X size={11} /></button>
            </span>
          ))}
        </div>
      )}

      {error ? (
        <div className="feed-empty">{error}</div>
      ) : rows === undefined ? (
        <div className="feed-empty">
          <LoaderCircle size={28} strokeWidth={1.5} className="spin" style={{ margin: '0 auto 10px' }} aria-hidden />
          <div>Loading workouts…</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="feed-empty">
          {rows.length > 0 ? (
            'No workouts match that.'
          ) : (
            <>
              <Handshake size={28} strokeWidth={1.5} style={{ margin: '0 auto 10px' }} aria-hidden />
              <div>{emptyMessage}</div>
            </>
          )}
        </div>
      ) : (
        <div className="workout-list" style={{ marginTop: 12 }}>
          {visible.map(w => (
            <WorkoutCard
              key={w.id}
              workout={w}
              variant="list"
              onClick={() => onSelect(w)}
// Names can be long, so they get their own row rather than
              // competing with the pace figure for the trailing cluster.
              footer={<Byline workout={w} kind={byline} onOpenUser={onOpenUser} />}
            />
          ))}
        </div>
      )}

      {hasMore && (
        <div ref={endOfList} className="load-more">
          <LoaderCircle size={14} className="spin" />
          {filtered.length - visible.length} more
        </div>
      )}

      {showFilters && (
        <FilterSheet
          groups={groups}
          onClose={() => setShowFilters(false)}
          onReset={active.length > 0 ? () => { setShown(PAGE_SIZE); setNarrow({ ...NONE, search }) } : undefined}
        />
      )}
    </>
  )
}

/**
 * Who a workout involves, under the card.
 *
 * One component for both directions because they are the same row with the
 * arrow reversed — the author of someone else's workout, or the people you sent
 * your own to — and drawing them differently would suggest a distinction that
 * is not there.
 */
function Byline({ workout: w, kind, onOpenUser }: {
  workout: Workout
  kind?: 'owner' | 'recipients'
  onOpenUser?: (id: number) => void
}) {
  const people = kind === 'recipients' ? w.sharedWith ?? [] : w.owner ? [w.owner] : []
  if (!kind || people.length === 0) return null

  const named = people.slice(0, NAMED_RECIPIENTS)
  const rest = people.length - named.length

  return (
    <span className="owner-byline">
      {kind === 'recipients' && <Send size={12} aria-hidden />}
      {named.map(p => (
        /* stopPropagation because the row itself opens the workout, and this
           opens the person. A plain span when there is nowhere to go, rather
           than a button that looks live and does nothing. */
        onOpenUser ? (
          <button
            key={p.id}
            type="button"
            className="owner-byline owner-byline-link"
            onClick={e => { e.stopPropagation(); onOpenUser(p.id) }}
          >
            <UserAvatar user={p} size={18} />
            <span>{userLabel(p)}</span>
          </button>
        ) : (
          <span key={p.id} className="owner-byline">
            <UserAvatar user={p} size={18} />
            <span>{userLabel(p)}</span>
          </span>
        )
      ))}
      {rest > 0 && <span className="owner-byline-more">and {rest} more</span>}
    </span>
  )
}
