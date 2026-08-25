import { useEffect, useMemo, useRef, useState } from 'react'
import { ClipboardList, Clock, CloudOff, FilterX, Ghost, History, LoaderCircle } from 'lucide-react'
import { clockLabel, elapsedSec, sessionWhen, type PlanSession, type TrainingPlan } from '../data/plans'
import type { Workout } from '../data/workouts'
import {
  applyItemFilters, asPlanItem, asSessionItem, asWorkoutItem,
  type FeedItem, type ItemKind, type ItemNarrowing,
} from '../lib/itemFilters'
import { useSessionState } from '../lib/useSessionState'
import { NO_NARROWING } from '../lib/itemFilters'
import { useOnlineStatus } from '../lib/network'
import ItemFilterBar from './ItemFilterBar'
import WorkoutCard from './WorkoutCard'
import { Byline } from './WorkoutFilterList'

/** Rendered per page, and how many more each time the end comes into view. */
const PAGE_SIZE = 20

/**
 * A searchable, filterable list of workouts, training plans and finished
 * sessions — any one kind, or all three interleaved by recency.
 *
 * One component for the mixed feeds on Discover, the two lists on a profile,
 * and the Plans and History tabs, because they are the same list with
 * different rows in it. Which filters it offers follows from which kinds it
 * holds; see ItemFilterBar, and lib/itemFilters for what the filters mean.
 */
export default function ItemList({
  workouts, plans, sessions, kinds, storageKey, emptyMessage, error, mine = false,
  searchPlaceholder, onSelectWorkout, onSelectPlan, onSelectSession, onOpenUser, footerFor,
}: {
  /** Undefined means "still loading"; an empty array means "none". A kind this
   *  list does not hold may simply be omitted. */
  workouts?: Workout[]
  plans?: TrainingPlan[]
  sessions?: PlanSession[]
  kinds: ItemKind[]
  /** Where this list's narrowing is remembered, per session. */
  storageKey: string
  emptyMessage: string
  error?: string | null
  mine?: boolean
  searchPlaceholder?: string
  onSelectWorkout?: (w: Workout) => void
  onSelectPlan?: (p: TrainingPlan) => void
  onSelectSession?: (s: PlanSession) => void
  onOpenUser?: (id: number) => void
  /** The row under a card, when the caller wants one — used for the "shared
   *  with" byline on your own outbound lists. */
  footerFor?: (item: FeedItem) => React.ReactNode
}) {
  // Any kind this list holds that has not arrived yet means the list as a
  // whole is still loading — a half-drawn feed that grows a second later is
  // worse than one that says so.
  const loading = (kinds.includes('workout') && workouts === undefined)
    || (kinds.includes('plan') && plans === undefined)
    || (kinds.includes('session') && sessions === undefined)

  // Opening an item unmounts this, so a search typed here would otherwise be
  // gone by the time the reader pressed back.
  const [narrow, setNarrow] = useSessionState<ItemNarrowing>(storageKey, NO_NARROWING)
  const [shown, setShown] = useState(PAGE_SIZE)

  const items = useMemo((): FeedItem[] => [
    ...(workouts ?? []).map(asWorkoutItem),
    ...(plans ?? []).map(asPlanItem),
    ...(sessions ?? []).map(asSessionItem),
  ], [workouts, plans, sessions])

  const counts = useMemo(() => {
    const c: Record<ItemKind, number> = { workout: 0, plan: 0, session: 0 }
    for (const it of items) c[it.kind]++
    return c
  }, [items])

  const filtered = useMemo(() => applyItemFilters(items, narrow), [items, narrow])
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

  // One funnel, so this is the only place that has to put the list back to the
  // first page when what it shows changes.
  const change = (next: ItemNarrowing) => { setShown(PAGE_SIZE); setNarrow(next) }
  const unreachable = !useOnlineStatus() && items.length === 0
  const narrowed = narrow.search !== '' || filtered.length !== items.length

  return (
    <>
      <ItemFilterBar
        narrow={narrow}
        onChange={change}
        counts={counts}
        kinds={kinds}
        mine={mine}
        searchPlaceholder={searchPlaceholder}
      />

      {error ? (
        <div className="feed-empty">{error}</div>
      ) : loading ? (
        <div className="feed-empty">
          <LoaderCircle size={28} strokeWidth={1.5} className="spin" style={{ margin: '0 auto 10px' }} aria-hidden />
          <div>Loading…</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="feed-empty">
          {items.length > 0 ? (
            <>
              Nothing matches that.
              {narrowed && (
                <div>
                  <button
                    className="btn btn-ghost"
                    style={{ marginTop: 12 }}
                    onClick={() => change(NO_NARROWING)}
                  >
                    <FilterX size={14} /> Clear filters
                  </button>
                </div>
              )}
            </>
          ) : unreachable ? (
            /* An empty feed and a feed we could not fetch look the same from
               here, and only one of them is the reader's fault to fix. */
            <>
              <CloudOff size={28} strokeWidth={1.5} style={{ margin: '0 auto 10px' }} aria-hidden />
              <div>Nothing can be loaded while you are offline.</div>
            </>
          ) : (
            <>
              <Ghost size={28} strokeWidth={1.5} style={{ margin: '0 auto 10px' }} aria-hidden />
              <div>{emptyMessage}</div>
            </>
          )}
        </div>
      ) : (
        <div className="workout-list" style={{ marginTop: 12 }}>
          {visible.map(it => {
            const footer = footerFor?.(it)
            if (it.workout) {
              const w = it.workout
              return (
                <WorkoutCard
                  key={`w-${w.id}`}
                  workout={w}
                  variant="list"
                  onClick={() => onSelectWorkout?.(w)}
                  footer={footer ?? (w.owner
                    ? <Byline people={[w.owner]} kind="owner" onOpenUser={onOpenUser} />
                    : undefined)}
                />
              )
            }
            if (it.plan) {
              const p = it.plan
              return (
                <PlanRow key={`p-${p.id}`} plan={p} onOpen={() => onSelectPlan?.(p)} onOpenUser={onOpenUser} footer={footer} />
              )
            }
            const s = it.session!
            return (
              <SessionRow key={`s-${s.id}`} session={s} onOpen={() => onSelectSession?.(s)} onOpenUser={onOpenUser} footer={footer} />
            )
          })}
        </div>
      )}

      {hasMore && (
        <div ref={endOfList} className="load-more">
          <LoaderCircle size={14} className="spin" />
          {filtered.length - visible.length} more
        </div>
      )}
    </>
  )
}

/**
 * One row for a plan or a session.
 *
 * Built on WorkoutCard's `.workout-row` classes rather than on `.plan-card`,
 * because these sit *directly beneath* workout rows and anything they do not
 * share reads as an inconsistency rather than a distinction. What legitimately
 * differs stays different: the accent colour, the icon, the badge naming the
 * kind, and the one headline figure on the right.
 *
 * A div, not a button: the owner byline inside is its own clickable control
 * (it opens a person, not the row), and a button cannot legally contain
 * another one. `.workout-row` is a div with an onClick for the same reason.
 */
function FeedRow({ accent, icon, badge, name, date, stats, figure, unit, owner, onOpen, onOpenUser, footer }: {
  accent: string
  icon: React.ReactNode
  badge: string
  name: string
  date: string
  stats: React.ReactNode
  figure: string
  unit: string
  owner?: { id: number; username: string; displayName: string; avatarPath: string }
  onOpen: () => void
  onOpenUser?: (id: number) => void
  footer?: React.ReactNode
}) {
  const byline = footer ?? (owner
    ? <Byline people={[owner]} kind="owner" onOpenUser={onOpenUser} />
    : undefined)
  return (
    <div
      className="workout-row"
      onClick={onOpen}
      style={{ '--row-accent': accent } as React.CSSProperties}
    >
      <div className="workout-row-icon" aria-hidden>{icon}</div>

      <div className="workout-row-body">
        <div className="workout-row-title">
          <span className="workout-row-name">{name}</span>
          <span className={`badge tag-${badge.toLowerCase()}`}>{badge}</span>
        </div>
        <div className="workout-row-meta">
          <span className="workout-row-date">{date}</span>
          <div className="workout-row-stats">{stats}</div>
        </div>
        {byline && <div className="workout-row-footer">{byline}</div>}
      </div>

      <div className="workout-row-aside">
        <div className="workout-row-pace">
          <b>{figure}</b>
          <small>{unit}</small>
        </div>
      </div>
    </div>
  )
}

function PlanRow({ plan, onOpen, onOpenUser, footer }: {
  plan: TrainingPlan; onOpen: () => void; onOpenUser?: (id: number) => void; footer?: React.ReactNode
}) {
  return (
    <FeedRow
      accent="var(--plan)"
      icon={<ClipboardList size={20} color="var(--plan)" />}
      badge="Plan"
      name={plan.name}
      date={shortDate(plan.updatedAt)}
      stats={plan.lastSessionAt
        ? <div className="workout-row-stat"><History size={11} color="var(--text-3)" /><span>run {shortDate(plan.lastSessionAt)}</span></div>
        : <div className="workout-row-stat"><span>never run</span></div>}
      figure={String(plan.dayCount)}
      unit={plan.dayCount === 1 ? 'day' : 'days'}
      owner={plan.owner}
      onOpen={onOpen}
      onOpenUser={onOpenUser}
      footer={footer}
    />
  )
}

function SessionRow({ session: s, onOpen, onOpenUser, footer }: {
  session: PlanSession; onOpen: () => void; onOpenUser?: (id: number) => void; footer?: React.ReactNode
}) {
  return (
    <FeedRow
      accent="var(--session)"
      icon={<History size={20} color="var(--session)" />}
      badge="Session"
      name={s.dayName}
      date={sessionWhen(s.startedAt)}
      stats={
        <>
          <div className="workout-row-stat">
            <ClipboardList size={11} color="var(--text-3)" /><span>{s.planName}</span>
          </div>
          <div className="workout-row-stat">
            <Clock size={11} color="var(--text-3)" />
            <span>{clockLabel(elapsedSec(s.startedAt, s.finishedAt))}</span>
          </div>
        </>
      }
      figure={`${s.doneSets}/${s.totalSets}`}
      unit="sets"
      owner={s.owner}
      onOpen={onOpen}
      onOpenUser={onOpenUser}
      footer={footer}
    />
  )
}

/** The same "Jul 26, 2026" a workout row shows, so the dates line up. */
function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
