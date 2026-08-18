import { useState } from 'react'
import {
  ArrowDownWideNarrow, ArrowUpNarrowWide, ArrowUpDown, CalendarArrowDown, CalendarArrowUp,
  CheckCheck, ClipboardList, ClockArrowDown, CircleDashed, FilterX, History,
  Layers, ListOrdered, NotebookPen, Play, SlidersHorizontal, X,
} from 'lucide-react'
import { ALL_WORKOUT_TYPES, type WorkoutType } from '../data/workouts'
import { RANGE_OPTIONS } from '../lib/range'
import { containsSheetOptions, containsState, cycleHas, MultiDropdown } from './ContainsDropdown'
import ContainsDropdown from './ContainsDropdown'
import { containsLabel } from './ContainsDropdown'
import { type Has } from '../lib/workoutFilters'
import {
  forKind, sortsFor,
  type ItemKind, type ItemNarrowing, type ItemSortKey, type Trait,
} from '../lib/itemFilters'
import { useIsMobile } from '../lib/useIsMobile'
import Dropdown from './Dropdown'
import FilterSheet, { type FilterGroup } from './FilterSheet'
import SearchInput from './SearchInput'
import TypeIcon from './TypeIcon'

const mark = (Icon: typeof ArrowUpDown) => <Icon size={14} color="var(--text-3)" aria-hidden />

/** Every sort's label and mark, keyed so a kind can pick the ones it answers. */
const SORT_LABEL: Record<ItemSortKey, { label: string; glyph: React.ReactNode }> = {
  'date-desc': { label: 'Newest first', glyph: mark(CalendarArrowDown) },
  'date-asc': { label: 'Oldest first', glyph: mark(CalendarArrowUp) },
  'distance-desc': { label: 'Longest distance', glyph: mark(ArrowDownWideNarrow) },
  'distance-asc': { label: 'Shortest distance', glyph: mark(ArrowUpNarrowWide) },
  'duration-desc': { label: 'Longest time', glyph: mark(ClockArrowDown) },
  'duration-asc': { label: 'Shortest time', glyph: mark(ArrowUpNarrowWide) },
  'name-asc': { label: 'Name A–Z', glyph: mark(ArrowUpNarrowWide) },
  'days-desc': { label: 'Most days', glyph: mark(ArrowDownWideNarrow) },
  'lastrun-desc': { label: 'Recently run', glyph: mark(Play) },
  'sets-desc': { label: 'Most sets', glyph: mark(ListOrdered) },
  'time-desc': { label: 'Longest time', glyph: mark(ClockArrowDown) },
}

const KIND_LABEL: Record<ItemKind, string> = { workout: 'Workouts', plan: 'Plans', session: 'Sessions' }
const KIND_GLYPH: Record<ItemKind, React.ReactNode> = {
  workout: <Layers size={13} color="var(--text-3)" aria-hidden />,
  plan: <ClipboardList size={13} color="var(--plan)" aria-hidden />,
  session: <History size={13} color="var(--session)" aria-hidden />,
}

const PLAN_DAYS_OPTIONS = [
  { value: 'all' as const, label: 'Any length' },
  { value: '1' as const, label: 'One day' },
  { value: '2-3' as const, label: '2–3 days' },
  { value: '4+' as const, label: '4 or more' },
]

const STATUS_OPTIONS = [
  { value: 'all' as const, label: 'Any result' },
  { value: 'complete' as const, label: 'Every set done', glyph: <CheckCheck size={13} color="var(--success)" aria-hidden /> },
  { value: 'partial' as const, label: 'Cut short', glyph: <CircleDashed size={13} color="var(--text-3)" aria-hidden /> },
]

/** The traits a kind can be asked about. A session is a run by definition. */
function traitOptions(kind: ItemKind | 'all'): { value: Trait; label: string; glyph: React.ReactNode }[] {
  const notes = { value: 'notes' as const, label: 'Notes', glyph: <NotebookPen size={14} /> }
  return kind === 'plan'
    ? [notes, { value: 'run' as const, label: 'Been run', glyph: <Play size={14} /> }]
    : [notes]
}

/**
 * The search box and filters above a mixed list of workouts, plans and
 * sessions.
 *
 * Which groups appear is driven by the chosen kind, which is itself the first
 * group — that is the whole design. The kind used to be a row of chips above
 * the list and the filters did not exist; putting it inside the filter is what
 * lets "Activity: Run" appear the moment Workouts is chosen and vanish again
 * when it is not, instead of every kind's controls being permanently on screen
 * doing nothing for two thirds of the rows.
 *
 * Desktop gets a row of dropdowns and mobile a single Filters button opening
 * the sheet, exactly as the workout library already did — the same two
 * renderings of one `FilterGroup[]`, so the phone and the laptop cannot end up
 * offering different filters.
 */
export default function ItemFilterBar({
  narrow, onChange, counts, kinds, mine = false, searchPlaceholder = 'Search everything…', trailing,
}: {
  narrow: ItemNarrowing
  onChange: (next: ItemNarrowing) => void
  /** How many rows of each kind exist before filtering, for the kind labels. */
  counts?: Record<ItemKind, number>
  /**
   * The kinds this list can hold. One kind means the selector is dropped and
   * that kind's own groups are always shown — which is how the Plans and
   * History tabs use this, having only ever held one thing.
   */
  kinds: ItemKind[]
  /** Whether these are the caller's own rows; unlocks the Notes filters. */
  mine?: boolean
  searchPlaceholder?: string
  /** Extra controls for the end of the row — the Plans and History tabs put
   *  their "Select" button here rather than in a second row of chrome. */
  trailing?: React.ReactNode
}) {
  const isMobile = useIsMobile()
  const [showSheet, setShowSheet] = useState(false)

  const patch = (next: Partial<ItemNarrowing>) => onChange({ ...narrow, ...next })
  /** A kind change also drops whatever the new kind cannot answer. */
  const setKind = (k: ItemKind | 'all') => onChange(forKind(narrow, k))

  // A single-kind list is always that kind, so the selector would be a control
  // with one option — and its groups should be on screen from the start.
  const kind: ItemKind | 'all' = kinds.length === 1 ? kinds[0] : narrow.kind
  const single = kinds.length === 1

  const sortOptions = sortsFor(kind).map(k => ({ value: k, ...SORT_LABEL[k] }))
  const traits = traitOptions(kind)

  const groups: FilterGroup[] = []

  if (!single) {
    groups.push({
      key: 'kind',
      label: 'Show',
      value: kind,
      onChange: v => setKind(v as ItemKind | 'all'),
      options: [
        { value: 'all', label: 'Everything', glyph: <Layers size={13} color="var(--text-3)" aria-hidden /> },
        ...kinds.map(k => ({
          value: k,
          label: counts ? `${KIND_LABEL[k]} (${counts[k]})` : KIND_LABEL[k],
          glyph: KIND_GLYPH[k],
        })),
      ],
    })
  }

  groups.push({
    key: 'sort',
    label: 'Sort by',
    value: narrow.sortBy,
    onChange: v => patch({ sortBy: v as ItemSortKey }),
    options: sortOptions,
  })

  groups.push({
    key: 'range',
    label: 'Period',
    value: narrow.rangeDays,
    onChange: v => patch({ rangeDays: v as number }),
    options: RANGE_OPTIONS.map(o => ({ value: o.value, label: o.label })),
  })

  if (kind === 'workout') {
    groups.push({
      key: 'type',
      label: 'Activity',
      value: narrow.typeFilter,
      onChange: v => patch({ typeFilter: v as WorkoutType | 'All' }),
      options: [
        { value: 'All', label: 'All types', glyph: <Layers size={13} color="var(--text-3)" aria-hidden /> },
        ...ALL_WORKOUT_TYPES.map(t => ({ value: t, label: t, glyph: <TypeIcon type={t} size={13} /> })),
      ],
    })
    groups.push({
      key: 'has',
      label: 'Contains',
      multi: true,
      value: narrow.has,
      onChange: v => patch({ has: cycleHas(narrow.has, v as Has) }),
      state: v => containsState(narrow.has, v),
      options: containsSheetOptions(mine, narrow.has),
    })
  }

  if (kind === 'plan') {
    groups.push({
      key: 'planDays',
      label: 'Days',
      value: narrow.planDays,
      onChange: v => patch({ planDays: v as ItemNarrowing['planDays'] }),
      options: PLAN_DAYS_OPTIONS,
    })
  }

  if (kind === 'session') {
    groups.push({
      key: 'status',
      label: 'Result',
      value: narrow.sessionStatus,
      onChange: v => patch({ sessionStatus: v as ItemNarrowing['sessionStatus'] }),
      options: STATUS_OPTIONS,
    })
  }

  if (kind === 'plan' || kind === 'session') {
    groups.push({
      key: 'traits',
      label: 'Contains',
      multi: true,
      value: narrow.traits,
      onChange: v => patch({ traits: toggleTrait(narrow.traits, v as Trait) }),
      options: traits,
    })
  }

  /** The chips naming what is applied, each able to clear just itself. */
  const active: { key: string; label: string; clear: () => void }[] = []
  if (!single && kind !== 'all') {
    active.push({ key: 'kind', label: KIND_LABEL[kind], clear: () => setKind('all') })
  }
  if (narrow.sortBy !== 'date-desc') {
    active.push({ key: 'sort', label: SORT_LABEL[narrow.sortBy].label, clear: () => patch({ sortBy: 'date-desc' }) })
  }
  if (narrow.rangeDays !== 0) {
    active.push({
      key: 'range',
      label: RANGE_OPTIONS.find(o => o.value === narrow.rangeDays)?.label ?? `${narrow.rangeDays}d`,
      clear: () => patch({ rangeDays: 0 }),
    })
  }
  if (narrow.typeFilter !== 'All') {
    active.push({ key: 'type', label: narrow.typeFilter, clear: () => patch({ typeFilter: 'All' }) })
  }
  for (const h of narrow.has) {
    active.push({ key: `has-${h}`, label: containsLabel(h), clear: () => patch({ has: narrow.has.filter(f => f !== h) }) })
  }
  if (narrow.planDays !== 'all') {
    active.push({
      key: 'planDays',
      label: PLAN_DAYS_OPTIONS.find(o => o.value === narrow.planDays)?.label ?? narrow.planDays,
      clear: () => patch({ planDays: 'all' }),
    })
  }
  if (narrow.sessionStatus !== 'all') {
    active.push({
      key: 'status',
      label: STATUS_OPTIONS.find(o => o.value === narrow.sessionStatus)?.label ?? narrow.sessionStatus,
      clear: () => patch({ sessionStatus: 'all' }),
    })
  }
  for (const t of narrow.traits) {
    active.push({
      key: `trait-${t}`,
      label: traits.find(o => o.value === t)?.label ?? t,
      clear: () => patch({ traits: narrow.traits.filter(x => x !== t) }),
    })
  }

  /** Back to nothing, keeping the search — clearing filters is not a reset. */
  const clearAll = () => onChange({
    ...forKind(narrow, single ? kinds[0] : 'all'),
    sortBy: 'date-desc',
    rangeDays: 0,
  })

  return (
    <>
      <div className="profile-tools">
        <SearchInput
          value={narrow.search}
          onChange={v => patch({ search: v })}
          placeholder={searchPlaceholder}
          minWidth={160}
        />
        {isMobile ? (
          <button
            className="btn btn-ghost filter-btn"
            onClick={() => setShowSheet(true)}
            aria-label={`Filters${active.length ? `, ${active.length} applied` : ''}`}
          >
            <SlidersHorizontal size={15} />
            {active.length > 0 && <span className="filter-count">{active.length}</span>}
          </button>
        ) : (
          <>
            {groups.map(g => (
              g.multi ? (
                g.key === 'has' ? (
                  <ContainsDropdown
                    key={g.key}
                    value={narrow.has}
                    onToggle={v => patch({ has: cycleHas(narrow.has, v) })}
                    mine={mine}
                  />
                ) : (
                  <MultiDropdown<Trait>
                    key={g.key}
                    label="Contains"
                    options={traits}
                    count={narrow.traits.length}
                    state={v => (narrow.traits.includes(v) ? 'on' : undefined)}
                    onToggle={v => patch({ traits: toggleTrait(narrow.traits, v) })}
                  />
                )
              ) : (
                <Dropdown
                  key={g.key}
                  value={g.value as string | number}
                  options={g.options}
                  onChange={g.onChange}
                  ariaLabel={g.label}
                  icon={g.key === 'sort' ? <ArrowUpDown size={13} color="var(--text-3)" style={{ flexShrink: 0 }} /> : undefined}
                  active={isGroupActive(g.key, narrow)}
                />
              )
            ))}
            {active.length > 0 && (
              <button
                className="btn-icon"
                onClick={clearAll}
                title={`Clear ${active.length} filter${active.length === 1 ? '' : 's'}`}
                aria-label="Clear filters"
              >
                <FilterX size={15} />
              </button>
            )}
          </>
        )}
        {trailing}
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

      {showSheet && (
        <FilterSheet
          groups={groups}
          onClose={() => setShowSheet(false)}
          onReset={active.length > 0 ? clearAll : undefined}
        />
      )}
    </>
  )
}

/** Whether a dropdown holds something other than its default, for the mark. */
function isGroupActive(key: string, n: ItemNarrowing): boolean {
  switch (key) {
    case 'kind': return n.kind !== 'all'
    case 'sort': return n.sortBy !== 'date-desc'
    case 'range': return n.rangeDays !== 0
    case 'type': return n.typeFilter !== 'All'
    case 'planDays': return n.planDays !== 'all'
    case 'status': return n.sessionStatus !== 'all'
    default: return false
  }
}

/** Plain on/off, unlike a workout attribute — there is no "no notes" case
 *  worth a third state on a list this small. */
function toggleTrait(current: Trait[], t: Trait): Trait[] {
  return current.includes(t) ? current.filter(x => x !== t) : [...current, t]
}
