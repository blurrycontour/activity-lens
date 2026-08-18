import { useMemo } from 'react'
import { ClipboardList, Clock, Ghost, History, LoaderCircle } from 'lucide-react'
import type { Workout } from '../data/workouts'
import { clockLabel, elapsedSec, sessionWhen, type PlanSession, type TrainingPlan } from '../data/plans'
import { planHaystack, sessionHaystack, workoutHaystack } from '../lib/discoverSearch'
import { useSessionState } from '../lib/useSessionState'
import SearchInput from './SearchInput'
import WorkoutCard from './WorkoutCard'
import { Byline } from './WorkoutFilterList'

type Kind = 'workout' | 'plan' | 'session'

interface Item {
  kind: Kind
  /** Recency key the three kinds are interleaved by — a workout's date, a
   *  plan's last edit, a session's start. */
  at: string
  workout?: Workout
  plan?: TrainingPlan
  session?: PlanSession
}

interface Narrowing {
  search: string
  type: Kind | 'all'
}

const NONE: Narrowing = { search: '', type: 'all' }

const TYPE_LABEL: Record<Kind, string> = { workout: 'Workouts', plan: 'Plans', session: 'Sessions' }

/**
 * Discover's Shared and Public tabs: workouts, plans and finished sessions in
 * one feed, newest first, with one search box and a type filter.
 *
 * A new component rather than teaching WorkoutFilterList a second and third
 * shape — that list is built entirely around workout-specific filters (type,
 * range, "contains") that plans and sessions have no equivalent of, and
 * bending it to hold three unrelated item shapes would make it the more
 * complicated thing rather than the shared one. This one stays proportionate
 * to what the other two actually need: a search and a which-kind toggle.
 */
export default function DiscoverFeedList({
  workouts, plans, sessions, storageKey, emptyMessage, error,
  onSelectWorkout, onSelectPlan, onSelectSession, onOpenUser,
}: {
  workouts: Workout[] | undefined
  plans: TrainingPlan[] | undefined
  sessions: PlanSession[] | undefined
  storageKey: string
  emptyMessage: string
  error?: string | null
  onSelectWorkout: (w: Workout) => void
  onSelectPlan: (p: TrainingPlan) => void
  onSelectSession: (s: PlanSession) => void
  onOpenUser?: (id: number) => void
}) {
  const loading = workouts === undefined || plans === undefined || sessions === undefined
  const [narrow, setNarrow] = useSessionState<Narrowing>(storageKey, NONE)

  const items = useMemo((): Item[] => {
    if (loading) return []
    const all: Item[] = [
      ...workouts.map(w => ({ kind: 'workout' as const, at: w.date, workout: w })),
      ...plans.map(p => ({ kind: 'plan' as const, at: p.updatedAt, plan: p })),
      ...sessions.map(s => ({ kind: 'session' as const, at: s.startedAt, session: s })),
    ]
    return all.sort((a, b) => b.at.localeCompare(a.at))
  }, [workouts, plans, sessions, loading])

  const counts = useMemo(() => {
    const c: Record<Kind, number> = { workout: 0, plan: 0, session: 0 }
    for (const it of items) c[it.kind]++
    return c
  }, [items])

  const filtered = useMemo(() => {
    const q = narrow.search.trim().toLowerCase()
    return items.filter(it => {
      if (narrow.type !== 'all' && it.kind !== narrow.type) return false
      if (!q) return true
      if (it.workout) return workoutHaystack(it.workout).includes(q)
      if (it.plan) return planHaystack(it.plan).includes(q)
      return it.session ? sessionHaystack(it.session).includes(q) : false
    })
  }, [items, narrow])

  return (
    <>
      <div className="discover-tools">
        <SearchInput
          value={narrow.search}
          onChange={v => setNarrow(n => ({ ...n, search: v }))}
          placeholder="Search everything…"
          minWidth={160}
        />
      </div>

      {/* Four chips rather than a dropdown: there is nothing else to narrow
          by across three unrelated shapes, so the whole filter fits in one
          row without needing a sheet to hold it. */}
      <div className="discover-type-chips" role="tablist" aria-label="Filter by type">
        {(['all', 'workout', 'plan', 'session'] as const).map(t => (
          <button
            key={t}
            role="tab"
            aria-selected={narrow.type === t}
            className={`discover-chip${narrow.type === t ? ' active' : ''}`}
            onClick={() => setNarrow(n => ({ ...n, type: t }))}
          >
            {t === 'all' ? 'All' : TYPE_LABEL[t]}
            {t !== 'all' && <span className="discover-chip-count plan-num">{counts[t]}</span>}
          </button>
        ))}
      </div>

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
            'Nothing matches that.'
          ) : (
            <>
              <Ghost size={28} strokeWidth={1.5} style={{ margin: '0 auto 10px' }} aria-hidden />
              <div>{emptyMessage}</div>
            </>
          )}
        </div>
      ) : (
        <div className="workout-list" style={{ marginTop: 12 }}>
          {filtered.map(it => {
            if (it.workout) {
              const w = it.workout
              return (
                <WorkoutCard
                  key={`w-${w.id}`}
                  workout={w}
                  variant="list"
                  onClick={() => onSelectWorkout(w)}
                  footer={w.owner ? <Byline people={[w.owner]} kind="owner" onOpenUser={onOpenUser} /> : undefined}
                />
              )
            }
            if (it.plan) return <PlanFeedCard key={`p-${it.plan.id}`} plan={it.plan} onOpen={() => onSelectPlan(it.plan!)} onOpenUser={onOpenUser} />
            const s = it.session!
            return <SessionFeedCard key={`s-${s.id}`} session={s} onOpen={() => onSelectSession(s)} onOpenUser={onOpenUser} />
          })}
        </div>
      )}
    </>
  )
}

/**
 * One row in the mixed feed, for a plan or a session.
 *
 * Built on WorkoutCard's `.workout-row` classes rather than on `.plan-card`,
 * because in this list the three kinds sit *directly beneath each other* and
 * anything they do not share reads as an inconsistency rather than as a
 * distinction. On `.plan-card` they had no accent bar, a flat grey circle
 * where a workout has a colour-filled tile, no badge naming what they were,
 * and the owner squeezed inline beside the figures instead of in the ruled
 * footer every workout puts it in.
 *
 * What legitimately differs stays different: the accent colour, the icon, the
 * badge, and the one headline figure on the right.
 *
 * A div, not a button: the owner byline inside is its own clickable control
 * (it opens a person, not the row), and a button cannot legally contain
 * another one. `.workout-row` is a div with an onClick for the same reason.
 */
function FeedRow({ accent, icon, badge, name, date, stats, figure, unit, owner, onOpen, onOpenUser }: {
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
}) {
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
        {owner && (
          <div className="workout-row-footer">
            <Byline people={[owner]} kind="owner" onOpenUser={onOpenUser} />
          </div>
        )}
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

function PlanFeedCard({ plan, onOpen, onOpenUser }: { plan: TrainingPlan; onOpen: () => void; onOpenUser?: (id: number) => void }) {
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
    />
  )
}

function SessionFeedCard({ session: s, onOpen, onOpenUser }: { session: PlanSession; onOpen: () => void; onOpenUser?: (id: number) => void }) {
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
    />
  )
}

/** The same "Jul 26, 2026" a workout row shows, so the dates line up. */
function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
