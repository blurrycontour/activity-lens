import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownAZ, ArrowUpAZ, CheckCheck, ClipboardList, History, Loader2, Play, Plus, X,
} from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import TabStrip from '../../components/TabStrip'
import Modal from '../../components/Modal'
import ListTools from './ListTools'
import ConfirmDialog from '../../components/ConfirmDialog'
import { useRefreshHandler } from '../../context/RefreshContext'
import PlanView from './PlanView'
import PlanEditor from './PlanEditor'
import SessionRunner from './SessionRunner'
import SessionHistory from './SessionHistory'
import FinishedSession from './FinishedSession'
import { api } from '../../lib/api'
import {
  clockLabel, durationLabel, elapsedMin, elapsedSec, type PlanSession, type TrainingPlan,
} from '../../data/plans'
import { clearCachedProgress } from './sessionCache'
import { useActiveSession } from '../../context/ActiveSessionContext'
import { useLongPress } from '../../lib/useLongPress'
import { useSelection } from '../../lib/useSelection'
import useTicker from '../../lib/useTicker'

interface Props {
  /** From the URL: a plan id, or "session" with a session id in `detail`. */
  section: string | null
  detail: string | null
  onOpen: (section: string | null, detail?: string | null) => void
}

type TabId = 'plans' | 'history'

/**
 * The Plans page and everything under it.
 *
 * Four surfaces sharing one route: the list, a plan being read, the same plan
 * being edited, and a session being run. They are here rather than in separate
 * pages because moving between them is a back arrow, not a page change — and
 * because the running session has to be reachable from anywhere, which means
 * one component owning "what is open".
 */
export default function PlansPage({ section, detail, onOpen }: Props) {
  const [plans, setPlans] = useState<TrainingPlan[] | null>(null)
  const [open, setOpen] = useState<TrainingPlan | null>(null)
  const [session, setSession] = useState<PlanSession | null>(null)
  const [tab, setTab] = useState<TabId>('plans')
  const [error, setError] = useState('')
  const [naming, setNaming] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [query, setQuery] = useState('')
  const [az, setAz] = useState(true)
  const [confirmBulk, setConfirmBulk] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  // Which plan is waiting for a day to be picked, from the list's start button.
  const [starting, setStarting] = useState<TrainingPlan | null>(null)
  // A start refused because one is already running. Held here rather than as a
  // line on the list, so it is shown wherever the tap happened.
  const [conflict, setConflict] = useState(false)
  const [names, setNames] = useState<string[]>([])
  // The three seconds between pressing start and the session existing. The
  // request is held here until the count reaches zero.
  const [counting, setCounting] = useState(false)
  const pending = useRef<{ planId: string; dayId: string } | null>(null)
  const cancelled = useRef(false)

  // Selecting plans to delete: the same gesture, the same toolbar and the same
  // back-to-cancel behaviour as workouts and history.
  const sel = useSelection<string>()

  // Shared with the dashboard and the navigation's live dot, so finishing a
  // session here takes the dot down everywhere at once.
  const { active, refresh: refreshActive, set: setActive } = useActiveSession()
  // The banner shows a clock, so something has to make it move. Only while
  // there is a session to show one for.
  useTicker(1000, !!active)

  const load = useCallback(async () => {
    try {
      const [list] = await Promise.all([api.listPlans(), refreshActive()])
      setPlans(list)
    } catch {
      setError('Could not load your plans.')
      setPlans([])
    }
  }, [refreshActive])

  useEffect(() => { void load() }, [load])
  // Pull to refresh, and the desktop refresh button.
  useRefreshHandler(load)

  // Suggestions follow the account rather than the device, so a name typed on
  // a phone turns up on a laptop. Fetched once per visit to the page.
  useEffect(() => {
    api.exerciseNames().then(r => setNames(r.names)).catch(() => {})
  }, [])

  // The URL decides what is open, so a reload, a shared link and the back
  // gesture all land in the same place.
  useEffect(() => {
    let cancelled = false
    if (section === 'session' && detail) {
      api.getPlanSession(detail)
        .then(s => { if (!cancelled) { setSession(s); setOpen(null) } })
        .catch(() => { if (!cancelled) onOpen(null) })
      return () => { cancelled = true }
    }
    setSession(null)
    if (section) {
      api.getPlan(section)
        .then(p => { if (!cancelled) setOpen(p) })
        .catch(() => { if (!cancelled) onOpen(null) })
    } else {
      setOpen(null)
      setEditing(false)
    }
    return () => { cancelled = true }
  }, [section, detail, onOpen])

  /**
   * Creating asks for the name first, and only then writes anything.
   *
   * It used to create a plan called "New plan" the moment the button was
   * tapped, which left one behind for every accidental press.
   */
  async function createPlan(name: string) {
    setCreating(true)
    try {
      const p = await api.createPlan({ name })
      setNaming(false)
      setPlans(cur => [p, ...(cur ?? [])])
      onOpen(p.id)
      // A brand-new plan has nothing to read, so it opens ready to be written.
      setEditing(true)
    } catch {
      setError('Could not create the plan.')
    } finally {
      setCreating(false)
    }
  }

  async function renamePlan(name: string) {
    if (!open) return
    try {
      const saved = await api.patchPlan(open.id, { name })
      setOpen(cur => (cur ? { ...cur, name: saved.name } : cur))
      setPlans(cur => cur?.map(p => (p.id === saved.id ? { ...p, name: saved.name } : p)) ?? cur)
    } catch {
      setError('Could not rename the plan.')
    } finally {
      setRenaming(false)
    }
  }

  /**
   * Starting a day: three seconds on the screen, then the session.
   *
   * The session is created *after* the count, not during it. A session's clock
   * starts the moment the server writes it, so creating it up front meant the
   * first three seconds of every session were the countdown — the elapsed time
   * was already running while the screen still said 3.
   *
   * The conflict is checked before the count for the same reason in reverse:
   * we already know whether something is running, so counting down and then
   * refusing was three seconds spent on an answer we had at the first tap.
   */
  function start(planId: string, dayId: string) {
    setStarting(null)
    if (active) {
      setConflict(true)
      return
    }
    cancelled.current = false
    pending.current = { planId, dayId }
    setCounting(true)
  }

  /** The count reached zero: create it now, and go. */
  async function beginSession() {
    const req = pending.current
    pending.current = null
    if (!req || cancelled.current) return
    try {
      const s = await api.startPlanSession(req.planId, req.dayId)
      if (cancelled.current) {
        // Cancelled between the request and its answer — the session exists
        // for a moment and must not be left behind.
        void api.deletePlanSession(s.id)
        return
      }
      setActive(s)
      enterSession(s)
    } catch (e) {
      setCounting(false)
      // Still handled, because the check above only knows what this tab knows:
      // another device may have started one a second ago.
      if (e instanceof Error && /already running/i.test(e.message)) {
        void refreshActive()
        setConflict(true)
      } else {
        setError('Could not start the session.')
      }
    }
  }

  function enterSession(s: PlanSession) {
    // A fresh session starts with no local ticks; a stale cache from a
    // discarded one would otherwise be read back into it.
    clearCachedProgress()
    setCounting(false)
    onOpen('session', s.id)
  }

  function cancelStart() {
    cancelled.current = true
    pending.current = null
    setCounting(false)
  }

  /** Straight into the day when there is only one; ask when there are several. */
  function startFromList(plan: TrainingPlan) {
    if (plan.days?.length === 1) return start(plan.id, plan.days[0].id)
    api.getPlan(plan.id)
      .then(full => {
        const days = full.days ?? []
        if (days.length === 1) return start(full.id, days[0].id)
        if (days.length === 0) {
          setError(`${full.name} has no days yet.`)
          return
        }
        setStarting(full)
      })
      .catch(() => setError('Could not open that plan.'))
  }

  /**
   * Deleting the selected plans.
   *
   * One request each rather than a bulk endpoint: plans are counted in
   * handfuls, not in years of history, and a second endpoint that deletes a
   * list is a second place for the ownership check to be written.
   */
  async function deletePicked() {
    setBulkBusy(true)
    const ids = sel.ids
    try {
      await Promise.all(ids.map(id => api.deletePlan(id)))
      setPlans(cur => cur?.filter(p => !ids.includes(p.id)) ?? cur)
      sel.stop()
      setConfirmBulk(false)
    } catch {
      setError('Could not delete all of those plans.')
      void load()
    } finally {
      setBulkBusy(false)
    }
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matched = q ? (plans ?? []).filter(p => planHaystack(p).includes(q)) : (plans ?? [])
    return [...matched].sort((a, b) => a.name.localeCompare(b.name) * (az ? 1 : -1))
  }, [plans, query, az])

  const allPicked = shown.length > 0 && shown.every(p => sel.selected?.has(p.id))

  // The dialogs that can be open over any surface below.
  const overlays = (
    <>
      {conflict && active && (
        <ConfirmDialog
          title="A session is already running"
          message={`${active.dayName} has been going for ${durationLabel(elapsedMin(active.startedAt))}. Finish or discard it before starting another.`}
          confirmLabel="Go to it"
          cancelLabel="Stay here"
          onConfirm={() => { setConflict(false); onOpen('session', active.id) }}
          onCancel={() => setConflict(false)}
        />
      )}
      {starting && (
        <DayPicker plan={starting} onPick={id => start(starting.id, id)} onCancel={() => setStarting(null)} />
      )}
      {counting && <Countdown onDone={beginSession} onCancel={cancelStart} />}
    </>
  )

  // --- the runner --------------------------------------------------------
  if (session && !session.finishedAt) {
    return (
      <>
        <SessionRunner
          session={session}
          onBack={() => onOpen(null)}
          /* The finished session replaces the running one in place. Clearing it
             and re-opening the same URL did nothing: the route is already
             /plans/session/<id>, so nothing changed for the effect that reads
             it to react to, and the page fell through to the list. */
          onFinished={s => { setActive(null); setSession(s); void load() }}
          onDiscarded={() => { setActive(null); setSession(null); void load(); onOpen(null) }}
        />
        {overlays}
      </>
    )
  }
  if (session) {
    return <FinishedSession session={session} onBack={() => onOpen(null)} />
  }

  // --- one plan, read or edited -------------------------------------------
  if (open) {
    return (
      <>
        {editing ? (
          <PlanEditor
            plan={open}
            suggestions={names}
            onDone={() => setEditing(false)}
            onSaved={saved => {
              setOpen(saved)
              setPlans(cur => cur?.map(p => (p.id === saved.id ? { ...saved, days: undefined } : p)) ?? cur)
            }}
          />
        ) : (
          <PlanView
            plan={open}
            onBack={() => onOpen(null)}
            onEdit={() => setEditing(true)}
            onRename={() => setRenaming(true)}
            onStart={dayId => start(open.id, dayId)}
            onDeleted={() => { void load(); onOpen(null) }}
          />
        )}
        {renaming && (
          <NameDialog
            title="Rename plan"
            initial={open.name}
            action="Save"
            busy={false}
            onSubmit={renamePlan}
            onCancel={() => setRenaming(false)}
          />
        )}
        {overlays}
      </>
    )
  }

  // --- the list ----------------------------------------------------------
  return (
    <>
      <PageHeader
        title="Plans"
        subtitle="Your training routines"
        actions={
          <button className="btn btn-primary desktop-only" onClick={() => setNaming(true)}>
            <Plus size={15} /> New plan
          </button>
        }
      />

      <div className="page-content">
        {error && <div className="status-msg err" role="alert">{error}</div>}

        {active && (
          <button className="card plan-resume" onClick={() => onOpen('session', active.id)}>
            <span className="plan-resume-dot" aria-hidden />
            <div className="plan-resume-text">
              <span className="field-label">Session in progress</span>
              <strong>{active.dayName}</strong>
              <span className="plan-resume-meta plan-num">
                {active.planName} · {clockLabel(elapsedSec(active.startedAt))}
              </span>
            </div>
            <span className="btn btn-primary plan-resume-cta"><Play size={14} /> Resume</span>
          </button>
        )}

        <TabStrip
          items={[
            { id: 'plans', label: 'Plans', icon: <ClipboardList size={15} /> },
            { id: 'history', label: 'History', icon: <History size={15} /> },
          ]}
          value={tab}
          onChange={setTab}
          ariaLabel="Plans sections"
          fill
        />

        {tab === 'history' ? (
          <SessionHistory onOpen={id => onOpen('session', id)} />
        ) : plans === null ? (
          <div className="page-loading"><Loader2 size={18} className="spin" /></div>
        ) : plans.length === 0 ? (
          <div className="empty-state">
            <ClipboardList size={28} aria-hidden />
            <p>No plans yet.</p>
            <p className="empty-state-hint">
              A plan is a set of days — Chest, Back, Legs — each holding the exercises,
              sets and weights you work through. Make one and you can start a session
              from it in the gym.
            </p>
          </div>
        ) : (
          <>
            {/* Always, not once there are five: the row carries the selection
                controls as well as the search, and a list you cannot select
                from is a list with no way to delete anything. */}
            {(
              <ListTools
                query={query}
                onQuery={setQuery}
                placeholder="Search plans…"
                label="Search plans"
                sort={
                  <button
                    className="btn btn-ghost plan-sort"
                    onClick={() => setAz(v => !v)}
                    aria-label={az ? 'Sorted A to Z; switch to Z to A' : 'Sorted Z to A; switch to A to Z'}
                  >
                    {az ? <ArrowDownAZ size={15} /> : <ArrowUpAZ size={15} />}
                    {az ? 'A–Z' : 'Z–A'}
                  </button>
                }
                noun="plans"
                selecting={sel.selecting}
                count={sel.count}
                total={shown.length}
                allSelected={allPicked}
                onSelect={() => sel.start()}
                onToggleAll={() => sel.setSelected(allPicked ? new Set() : new Set(shown.map(p => p.id)))}
                onDelete={() => setConfirmBulk(true)}
                onCancel={() => sel.stop()}
              />
            )}

            {shown.length === 0 ? (
              <div className="empty-state">
                <p>No plan matches “{query}”.</p>
              </div>
            ) : (
              <div className="plan-list">
                {shown.map(p => (
                  <PlanRow
                    key={p.id}
                    plan={p}
                    selecting={sel.selecting}
                    picked={sel.selected?.has(p.id) ?? false}
                    onOpen={() => onOpen(p.id)}
                    onStart={() => startFromList(p)}
                    onToggle={() => sel.toggle(p.id)}
                    onLongPress={() => sel.start(p.id)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Only over the plans, and only when not picking things to delete:
          "new plan" is not the action you are reaching for while reading what
          you already did, nor while choosing what to throw away. */}
      {tab === 'plans' && !sel.selecting && (
        <button className="fab" onClick={() => setNaming(true)} title="New plan" aria-label="New plan">
          <Plus size={22} />
        </button>
      )}

      {confirmBulk && (
        <ConfirmDialog
          title={`Delete ${sel.count} plan${sel.count === 1 ? '' : 's'}?`}
          message="The plans and their days go. Sessions you have already run stay in your history, with the exercises as they were on the day."
          confirmLabel="Delete"
          danger
          busy={bulkBusy}
          onConfirm={deletePicked}
          onCancel={() => setConfirmBulk(false)}
        />
      )}

      {naming && (
        <NameDialog
          title="New plan"
          initial=""
          action="Create"
          placeholder="Push / Pull / Legs"
          busy={creating}
          onSubmit={createPlan}
          onCancel={() => setNaming(false)}
        />
      )}
      {overlays}
    </>
  )
}

/**
 * One plan in the list: open it, start it, or — held — select it.
 *
 * The card is two controls, so it is a div holding both: a button inside a
 * button is not markup that exists. While selecting it becomes one control,
 * because starting a session is not something to offer in the middle of
 * choosing what to delete.
 */
function PlanRow({ plan, selecting, picked, onOpen, onStart, onToggle, onLongPress }: {
  plan: TrainingPlan
  selecting: boolean
  picked: boolean
  onOpen: () => void
  onStart: () => void
  onToggle: () => void
  onLongPress: () => void
}) {
  const press = useLongPress(() => { if (!selecting) onLongPress() })
  return (
    <div className={`card plan-card plan-card-row${picked ? ' picked' : ''}`}>
      <button
        className="plan-card-open"
        onClick={() => {
          if (press.consumedClick()) return
          if (selecting) onToggle()
          else onOpen()
        }}
        {...press.handlers}
        aria-pressed={selecting ? picked : undefined}
      >
        {selecting && (
          <span className="plan-pick" aria-hidden>{picked && <CheckCheck size={14} />}</span>
        )}
        <div className="plan-card-main">
          <strong className="plan-card-name">{plan.name}</strong>
          <span className="plan-card-meta plan-num">
            {plan.dayCount} day{plan.dayCount === 1 ? '' : 's'}
            {plan.lastSessionAt && ` · last run ${relativeDay(plan.lastSessionAt)}`}
          </span>
        </div>
        {plan.archived && <span className="plan-badge">Archived</span>}
      </button>
      {/* Straight into training, without opening the plan first: the common
          case is the same day you did last week. */}
      {!selecting && (
        <button
          className="btn-icon plan-card-start"
          onClick={onStart}
          title={`Start ${plan.name}`}
          aria-label={`Start ${plan.name}`}
          disabled={plan.dayCount === 0}
        >
          <Play size={16} />
        </button>
      )}
    </div>
  )
}

/** Asks for a name — used by both "new plan" and "rename". */
function NameDialog({ title, initial, action, placeholder, busy, onSubmit, onCancel }: {
  title: string
  initial: string
  action: string
  placeholder?: string
  busy: boolean
  onSubmit: (name: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial)
  return (
    <Modal onClose={onCancel} label={title}>
      <form
        className="modal-box"
        style={{ maxWidth: 420 }}
        onSubmit={e => { e.preventDefault(); if (name.trim()) onSubmit(name.trim()) }}
      >
        <div className="dialog-head">
          <h3 style={{ fontSize: 16, fontWeight: 700 }}>{title}</h3>
          <button type="button" className="btn-icon" onClick={onCancel} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <label className="form-label" htmlFor="plan-name-field">Plan name</label>
        <input
          id="plan-name-field"
          className="input"
          value={name}
          autoFocus
          placeholder={placeholder}
          onChange={e => setName(e.target.value)}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim() || busy}>
            {busy ? <Loader2 size={15} className="spin" /> : null} {action}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/** Which day, when a plan has more than one and the start came from the list. */
function DayPicker({ plan, onPick, onCancel }: {
  plan: TrainingPlan
  onPick: (dayId: string) => void
  onCancel: () => void
}) {
  return (
    <Modal onClose={onCancel} label={`Start a day of ${plan.name}`}>
      <div className="modal-box" style={{ maxWidth: 420 }}>
        <div className="dialog-head">
          <h3 style={{ fontSize: 16, fontWeight: 700 }}>Start which day?</h3>
          <button type="button" className="btn-icon" onClick={onCancel} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        {/* The whole row is the button, so there is no play icon on it: an
            icon inside a control that is already entirely tappable invites a
            press on the icon specifically, which is the smallest target here. */}
        <div className="plan-list">
          {(plan.days ?? []).map(d => (
            <button
              key={d.id}
              className="card plan-card"
              disabled={d.blocks.length === 0}
              onClick={() => onPick(d.id)}
            >
              <div className="plan-card-main">
                <strong className="plan-card-name">{d.name}</strong>
                <span className="plan-card-meta plan-num">
                  {d.blocks.length} exercise{d.blocks.length === 1 ? '' : 's'}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  )
}

/**
 * Three, two, one — then the session opens.
 *
 * A session starts the moment it is created, so the first thing recorded used
 * to be however long it took to put the phone down. The count is also the only
 * chance to undo a mistaken tap: after it, stopping a session means discarding
 * it.
 */
function Countdown({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [n, setN] = useState(3)
  const done = useRef(onDone)
  done.current = onDone

  useEffect(() => {
    if (n <= 0) return
    const id = window.setTimeout(() => setN(n - 1), 1000)
    return () => window.clearTimeout(id)
  }, [n])

  // Separate from the tick above: calling out from inside a state updater
  // runs it during this component's render, and what it does is open another
  // page — which React rightly complains about.
  useEffect(() => { if (n === 0) done.current() }, [n])

  return (
    <Modal onClose={onCancel} label="Starting your session">
      <div className="plan-countdown">
        <span className="plan-countdown-n plan-num" aria-live="assertive">{n || 'Go'}</span>
        <p className="plan-countdown-hint">Starting your session</p>
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </Modal>
  )
}

/**
 * Everything about a plan worth typing to find it, lowercased once.
 *
 * A name is not the only thing you remember about a plan — "the one I last
 * did on a Tuesday" or "the four-day one" are just as real a search. Rather
 * than a name-only filter, every date the plan carries is spelled out in
 * words (weekday, month, day, year) so any of those is a match too.
 */
function planHaystack(p: TrainingPlan): string {
  const dates = [p.createdAt, p.updatedAt, p.lastSessionAt].filter((s): s is string => !!s)
  const words = dates.flatMap(iso => {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return []
    return [d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })]
  })
  return [p.name, `${p.dayCount} day${p.dayCount === 1 ? '' : 's'}`, ...words].join(' ').toLowerCase()
}

/** "today", "yesterday", or a date — the resolution people actually want. */
function relativeDay(iso: string): string {
  const then = new Date(iso)
  const days = Math.floor((Date.now() - then.getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return then.toLocaleDateString()
}
