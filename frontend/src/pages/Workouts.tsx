import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { ALL_WORKOUT_TYPES, fmtDist, fmtDuration, TYPE_COLOR, type WorkoutType, type Workout } from '../data/workouts'
import TypeIcon from '../components/TypeIcon'
import ShareBadge from '../components/ShareBadge'
import ViewSwitcher, { readView, writeView, type ListView } from '../components/ViewSwitcher'
import { useWorkouts } from '../context/WorkoutsContext'
import { Search, Plus, Share2, FilterX, SlidersHorizontal, X, LoaderCircle, Layers, Image as ImageIcon, MoreVertical, Copy } from 'lucide-react'
import TypeDropdown from '../components/TypeDropdown'
import RangeDropdown from '../components/RangeDropdown'
import SortDropdown, { SORT_OPTIONS, type SortKey } from '../components/SortDropdown'
import FilterSheet, { type FilterGroup } from '../components/FilterSheet'
import ContainsDropdown, { containsLabel, containsSheetOptions, containsState, cycleHas } from '../components/ContainsDropdown'
import MenuButton from '../components/MenuButton'
import ShareDialog from '../components/ShareDialog'
import ShareCardDialog from '../components/ShareCardDialog'
import WorkoutCard from '../components/WorkoutCard'
import ConfirmDialog from '../components/ConfirmDialog'
import DuplicatesDialog from '../components/DuplicatesDialog'
import { RANGE_OPTIONS } from '../lib/range'
import { api } from '../lib/api'
import { useIsMobile } from '../lib/useIsMobile'
import { LOCATION_EVENT } from '../App'
import { useSessionState } from '../lib/useSessionState'
import SearchInput from '../components/SearchInput'
import SelectionBar from '../components/SelectionBar'
import {
  applyWorkoutFilters, DEFAULT_FILTERS, describeImportWindow, parseAutoImportParams,
  type Has, type WorkoutFilters,
} from '../lib/workoutFilters'

const FILTERS_KEY = 'workouts.filters'
const SHOWN_KEY = 'workouts.shown'
/** Set only while leaving for a workout, so the page count survives that trip. */
const RESUME_KEY = 'workouts.resume'

/** Cards rendered per page, and how many more each time the end comes into view. */
const PAGE_SIZE = 20

interface WorkoutsProps {
  onSelect: (w: Workout) => void
  onImport: () => void
}

/**
 * Your training log, and only ever yours.
 *
 * It used to carry two more tabs — shared with me, and public — which made this
 * page answer two unrelated questions at once: how your own training is going,
 * and what everyone else has been posting. Every control here had to be
 * qualified by which tab was showing: the count in the header, the import
 * button, bulk selection, the sharing filter, the duplicate finder. All of that
 * moved to Discover, where other people's workouts belong, and what is left is
 * one library with nothing to disambiguate.
 */
export default function Workouts({ onSelect, onImport }: WorkoutsProps) {
  const { workouts, loading, refresh } = useWorkouts()
  // Opening a workout unmounts this page, so every filter lived exactly as long
  // as it took to look at one result and come back. Kept in sessionStorage
  // rather than component state: it survives the round trip and a reload, and
  // still starts clean in a new session, which is what someone expects of a
  // search box they typed into an hour ago.
  const [filters, setFilters] = useSessionState<WorkoutFilters>(FILTERS_KEY, DEFAULT_FILTERS)
  const { search, typeFilter, sortBy, rangeDays, has, originFilter, since } = filters
  /**
   * How much of the filtered list is rendered. A library runs to thousands of
   * workouts and every card draws a sparkline, so the whole thing is a slow
   * first paint for a list nobody scrolls to the bottom of.
   *
   * Carried across the unmount that opening a workout causes — a count that
   * reset there would strand the restored scroll position past the end of the
   * list — but *only* across that one. Arriving at the page any other way
   * starts at the first page again, which is why this is not simply sessioned
   * like the filters are: stored on its own, one long scroll would make every
   * later visit in the same session render the whole library.
   */
  const [shown, setShown] = useState(() => {
    if (!sessionStorage.getItem(RESUME_KEY)) return PAGE_SIZE
    const saved = Number(sessionStorage.getItem(SHOWN_KEY))
    return Number.isFinite(saved) && saved > PAGE_SIZE ? saved : PAGE_SIZE
  })
  // Cleared in an effect rather than in the initializer above: StrictMode calls
  // an initializer twice, and consuming the flag there would make the second
  // call disagree with the first.
  useEffect(() => { sessionStorage.removeItem(RESUME_KEY) }, [])
  useEffect(() => { sessionStorage.setItem(SHOWN_KEY, String(shown)) }, [shown])

  /** Opens a workout, marking this as the trip the page count survives. */
  const openWorkout = useCallback((w: Workout) => {
    sessionStorage.setItem(RESUME_KEY, '1')
    onSelect(w)
  }, [onSelect])

  const showMore = useCallback(() => setShown(s => s + PAGE_SIZE), [])
  const patch = useCallback(
    (next: Partial<WorkoutFilters>) => {
      // Every filter change funnels through here, so this is the one place that
      // has to put the list back to the first page.
      setShown(PAGE_SIZE)
      setFilters(prev => ({ ...prev, ...next }))
    },
    [setFilters],
  )
  const setSearch = (v: string) => patch({ search: v })
  const setTypeFilter = (v: WorkoutType | 'All') => patch({ typeFilter: v })
  const setSortBy = (v: SortKey) => patch({ sortBy: v })
  const setRangeDays = (v: number) => patch({ rangeDays: v })
  /** with → without → off, for one attribute; they narrow together. */
  const toggleHas = (v: Has) => patch({ has: cycleHas(has, v) })
  const [sharing, setSharing] = useState<Workout | null>(null)
  const [cardFor, setCardFor] = useState<Workout | null>(null)
  /** A bulk delete that partly failed, shown above the list. */
  const [listError, setListError] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  /**
   * Bulk selection, entered by pressing and holding a workout.
   *
   * null rather than an empty set, so "not selecting" and "selecting nothing"
   * stay distinct: the second is a real state the user can reach by deselecting
   * their last row, and the toolbar has to stay up when they do.
   *
   */
  const [selected, setSelected] = useState<Set<string> | null>(null)
  // Whether a history entry is standing in for the selection, so Android's back
  // gesture — and the browser's back button — cancel it rather than leaving the
  // page. Tracked in a ref because the popstate listener would otherwise close
  // over a stale copy.
  const selectionEntry = useRef(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showDuplicates, setShowDuplicates] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const selecting = selected !== null
  const isMobile = useIsMobile()
  const [view, setView] = useState<ListView>(() => readView('workouts.view'))

  function changeView(v: ListView) {
    setView(v)
    writeView('workouts.view', v)
  }

  // Claims a ?source= filter from the URL, on mount and whenever a link lands
  // here while this page is already showing.
  useEffect(() => {
    const claim = () => {
      const claimed = parseAutoImportParams(window.location.search)
      if (!claimed) return
      patch(claimed)
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
        // ALL_WORKOUT_TYPES rather than WORKOUT_TYPES: a filter has to be able
        // to reach every workout, including the ones that could not be
        // classified, and those are exactly the ones worth going and fixing.
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

  /** Only non-default filters count towards the badge and the chip row. */
  const activeFilters = [
    typeFilter !== 'All' && { key: 'type', label: typeFilter, clear: () => setTypeFilter('All') },
    rangeDays !== 0 && { key: 'range', label: RANGE_OPTIONS.find(o => o.value === rangeDays)?.label ?? '', clear: () => setRangeDays(0) },
    sortBy !== 'date-desc' && { key: 'sort', label: SORT_OPTIONS.find(o => o.value === sortBy)?.label ?? '', clear: () => setSortBy('date-desc') },
    ...has.map(h => ({
      key: `has-${h}`,
      label: containsLabel(h),
      clear: () => patch({ has: has.filter(f => f !== h) }),
    })),
    originFilter === 'autoimport' && {
      key: 'origin',
      label: describeImportWindow(since),
      clear: () => patch({ originFilter: null, since: null, until: null }),
    },
  ].filter(Boolean) as { key: string; label: string; clear: () => void }[]

  /** Back to an unfiltered library, search included. */
  function resetFilters() {
    setShown(PAGE_SIZE)
    setFilters(DEFAULT_FILTERS)
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
  /**
   * Deletes workouts by id, then reloads the library.
   *
   * Shared by the selection toolbar and the duplicates dialog, which both need
   * "delete these, then say what actually happened". Throws when any of them
   * failed so the caller can report it on its own surface; the refresh has
   * already run by then, so whatever survived is on screen either way.
   */
  const deleteIds = useCallback(async (ids: string[]) => {
    let failed = 0
    for (const id of ids) {
      try {
        await api.deleteWorkout(id)
      } catch {
        failed++
      }
    }
    await refresh()
    if (failed > 0) throw new Error(`${failed} of ${ids.length} could not be deleted.`)
  }, [refresh])

  async function deleteSelected() {
    setDeleting(true)
    try {
      await deleteIds([...(selected ?? [])])
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Some workouts could not be deleted.')
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
      stopSelecting()
    }
  }

  /**
   * Actions on the library as a whole, as opposed to filters on the view.
   *
   * Its own menu because there is exactly one of them today and a button
   * labelled "Find duplicates" sitting permanently in a filter row would claim
   * more of it than a maintenance task deserves.
   */
  const listTools = (
    <MenuButton icon={<MoreVertical size={15} />} label="Library options">
      <button className="options-menu-item" onClick={() => setShowDuplicates(true)}>
        <Copy size={14} /> Find duplicates
      </button>
    </MenuButton>
  )

  const source = workouts
  const busy = loading

  const filtered = useMemo(
    // Scope pinned rather than read from the stored filters: a session that
    // started before the feeds moved to Discover still has "shared" saved, and
    // that would quietly disable the sharing filter on your own library.
    () => applyWorkoutFilters(source ?? [], { ...filters, scope: 'mine' }),
    [source, filters],
  )
  const visible = useMemo(() => filtered.slice(0, shown), [filtered, shown])
  const hasMore = filtered.length > visible.length

  /**
   * Whether every workout the filters match is selected — all of them, not just
   * the page that happens to be rendered. Paging is a display detail, and a
   * "Select all" that quietly meant "these twenty" would be a trap in front of
   * a Delete button.
   *
   * Checked by membership rather than by comparing sizes: changing a filter
   * mid-selection leaves ids selected that the list no longer shows, which
   * would make the counts agree while the visible rows were not all ticked.
   */
  const allSelected = useMemo(
    () => filtered.length > 0 && filtered.every(w => selected?.has(w.id)),
    [filtered, selected],
  )
  const toggleAll = useCallback(
    () => setSelected(allSelected ? new Set() : new Set(filtered.map(w => w.id))),
    [allSelected, filtered],
  )

  /**
   * Loads the next page when the end of the list comes within a screen or so.
   *
   * Re-created whenever the count changes, deliberately: a fresh observer
   * reports the current intersection immediately, so a page that lands entirely
   * above the fold keeps loading until the end is genuinely below it. Watching
   * only for a crossing would stall there until the user nudged the scroll.
   */
  const endOfList = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = endOfList.current
    if (!el || !hasMore) return
    const io = new IntersectionObserver(
      entries => { if (entries.some(e => e.isIntersecting)) showMore() },
      // Enough to load before the end is reached, not so much that a first page
      // taller than the viewport counts as "near the end" and loads a second
      // one before anything has been scrolled.
      { rootMargin: '300px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, showMore, shown])

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 14 }}>
          <h1 className="page-header-title">Workouts</h1>
          <span style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
            {filtered.length} of {source?.length ?? 0}
          </span>
          {/* Desktop only: the phone has the floating button, and a header
              full of controls is what pushed the list below the fold there. */}
          <button className="btn btn-primary desktop-only" onClick={onImport}>
            <Plus size={16} /> Add workout
          </button>
          {/* The push to the right edge lives here rather than on the Add
              button beside it: that button is desktop-only, so on a phone
              there was nothing left holding this cluster right and the
              switcher slid up against the title. */}
          <div style={{ marginLeft: 'auto' }}>
            <ViewSwitcher view={view} onChange={changeView} />
          </div>
        </div>

        {/* While selecting, the toolbar takes the filter row's place rather than
            adding a second bar: the two are never useful at once, and pushing the
            list down a row on a phone would cost more than it gives. */}
        {selecting ? (
          <SelectionBar
            count={selected?.size ?? 0}
            total={filtered.length}
            allSelected={allSelected}
            noun="workouts"
            compact={isMobile}
            onCancel={() => stopSelecting()}
            onToggleAll={toggleAll}
            onDelete={() => setConfirmDelete(true)}
          />
        ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search workouts..."
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
          ) : null}
          {isMobile ? listTools : null}
          {!isMobile ? (
            <>
              <TypeDropdown value={typeFilter} onChange={v => setTypeFilter(v)} />
              <SortDropdown value={sortBy} onChange={setSortBy} />
              <RangeDropdown value={rangeDays} onChange={setRangeDays} />
              <ContainsDropdown value={has} onToggle={toggleHas} mine />
              {/* Icon only: the row already carries four dropdowns and a menu,
                  and this appears only when there is something to clear — a
                  permanently visible "Reset" would be a word of nothing most
                  of the time. */}
              {activeFilters.length > 0 && (
                <button
                  className="btn-icon"
                  onClick={resetFilters}
                  title={`Clear ${activeFilters.length} filter${activeFilters.length === 1 ? '' : 's'}`}
                  aria-label="Clear filters"
                >
                  <FilterX size={15} />
                </button>
              )}
              {listTools}
            </>
          ) : null}
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
        {listError ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-3)' }}>
            <p style={{ fontSize: 14 }}>{listError}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-3)' }}>
            {busy
              ? <LoaderCircle size={32} strokeWidth={1.5} className="spin" style={{ margin: '0 auto 12px' }} aria-hidden />
              : <Search size={32} strokeWidth={1.5} style={{ margin: '0 auto 12px' }} aria-hidden />}
            <p style={{ fontSize: 14 }}>
              {busy
                ? 'Loading workouts…'
                : activeFilters.length > 0 || search
                  ? 'No workouts match these filters'
                  : 'No workouts found'}
            </p>
            {/* The way out, where the problem is. A desktop had no reset at
                all, so a filter left on from an earlier visit read as an empty
                library with nothing to explain it. */}
            {!busy && (activeFilters.length > 0 || search) && (
              <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={resetFilters}>
                <FilterX size={14} /> Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className={view === 'grid' ? 'workout-grid' : 'workout-list'}>
            {visible.map(w => (
              <WorkoutCard
                key={w.id}
                workout={w}
                variant={view}
                selectable
                selected={selected?.has(w.id) ?? false}
                selecting={selecting}
                onLongPress={() => startSelecting(w.id)}
                onClick={() => (selecting ? toggle(w.id) : openWorkout(w))}
                badge={<ShareBadge workout={w} />}
                aside={(
                  <>
                    {/* Both ways of sharing, the same pair the detail page
                        offers. A link needs the server and the workout to be
                        shareable; a card is made from what is already here. */}
                    <MenuButton icon={<Share2 size={15} />} label="Share">
                      <button className="options-menu-item" onClick={() => setSharing(w)}>
                        <Share2 size={14} /> Share
                      </button>
                      <button className="options-menu-item" onClick={() => setCardFor(w)}>
                        <ImageIcon size={14} /> Share card
                      </button>
                    </MenuButton>
                  </>
                )}
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
      </div>

      {showFilters && (
        <FilterSheet
          groups={[...filterGroups, {
            key: 'has',
            label: 'Contains',
            multi: true,
            value: has,
            onChange: v => toggleHas(v as Has),
            state: v => containsState(has, v),
            options: containsSheetOptions(true, has),
          }]}
          onClose={() => setShowFilters(false)}
          onReset={activeFilters.length > 0 ? resetFilters : undefined}
        />
      )}

      {sharing && (
        <ShareDialog
          kind="workout"
          id={sharing.id}
          noun="workout"
          subject={{
            icon: <TypeIcon type={sharing.type} />,
            name: sharing.name,
            meta: [
              new Date(sharing.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
              sharing.distance > 0 ? fmtDist(sharing.distance) : null,
              sharing.duration > 0 ? fmtDuration(sharing.duration) : null,
            ].filter(Boolean).join(' · '),
            accent: TYPE_COLOR[sharing.type],
          }}
          onClose={() => setSharing(null)}
          // The badges are driven by the library array, which WorkoutsContext
          // owns and the dashboard also reads — so re-fetch rather than patch
          // a local copy.
          onChange={() => { void refresh() }}
        />
      )}

      {cardFor && <ShareCardDialog workout={cardFor} onClose={() => setCardFor(null)} />}

      {showDuplicates && (
        <DuplicatesDialog
          // The whole library, not the filtered view: a duplicate hidden by
          // the current range or sport filter is still a duplicate, and one
          // that only showed up under the right filter would be worse than
          // none at all.
          workouts={workouts}
          onClose={() => setShowDuplicates(false)}
          onDelete={deleteIds}
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

      <button className="fab" onClick={onImport} title="Add Workout" aria-label="Add workout">
        <Plus size={24} strokeWidth={2.5} />
      </button>
    </div>
  )
}

