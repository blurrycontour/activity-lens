import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowDownAZ, ArrowUpAZ, ClipboardList, History, Loader2, Play, Plus, X,
} from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import TabStrip from '../../components/TabStrip'
import Modal from '../../components/Modal'
import SearchInput from '../../components/SearchInput'
import ConfirmDialog from '../../components/ConfirmDialog'
import { useRefreshHandler } from '../../context/RefreshContext'
import PlanView from './PlanView'
import PlanEditor from './PlanEditor'
import SessionRunner from './SessionRunner'
import SessionHistory from './SessionHistory'
import FinishedSession from './FinishedSession'
import { api } from '../../lib/api'
import {
  durationLabel, elapsedMin, type PlanSession, type TrainingPlan,
} from '../../data/plans'
import { clearCachedProgress } from './sessionCache'

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
  const [active, setActive] = useState<PlanSession | null>(null)
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
  // Which plan is waiting for a day to be picked, from the list's start button.
  const [starting, setStarting] = useState<TrainingPlan | null>(null)
  // A start refused because one is already running. Held here rather than as a
  // line on the list, so it is shown wherever the tap happened.
  const [conflict, setConflict] = useState(false)
  const [names, setNames] = useState<string[]>([])

  const load = useCallback(async () => {
    try {
      const [list, running] = await Promise.all([
        api.listPlans(),
        api.activePlanSession().catch(() => undefined),
      ])
      setPlans(list)
      setActive(running ?? null)
    } catch {
      setError('Could not load your plans.')
      setPlans([])
    }
  }, [])

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

  async function start(planId: string, dayId: string) {
    setStarting(null)
    try {
      const s = await api.startPlanSession(planId, dayId)
      // A fresh session starts with no local ticks; a stale cache from a
      // discarded one would otherwise be read back into it.
      clearCachedProgress()
      setActive(s)
      onOpen('session', s.id)
    } catch (e) {
      // 409 is the one worth handling: the answer is not an error message but
      // a way to the session already running.
      if (e instanceof Error && /already running/i.test(e.message)) setConflict(true)
      else setError('Could not start the session.')
    }
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

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matched = q ? (plans ?? []).filter(p => p.name.toLowerCase().includes(q)) : (plans ?? [])
    return [...matched].sort((a, b) => a.name.localeCompare(b.name) * (az ? 1 : -1))
  }, [plans, query, az])

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
    </>
  )

  // --- the runner --------------------------------------------------------
  if (session && !session.finishedAt) {
    return (
      <>
        <SessionRunner
          session={session}
          onBack={() => onOpen(null)}
          onFinished={s => { setActive(null); setSession(null); void load(); onOpen('session', s.id) }}
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
                {active.planName} · {durationLabel(elapsedMin(active.startedAt))} so far
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
            {/* Search earns its place once there are more than a handful, and
                costs a row of chrome before that. */}
            {plans.length > 4 && (
              <div className="discover-tools">
                <SearchInput
                  value={query}
                  onChange={setQuery}
                  placeholder="Search plans…"
                  label="Search plans"
                  minWidth={160}
                />
                <button
                  className="btn btn-ghost"
                  onClick={() => setAz(v => !v)}
                  aria-label={az ? 'Sorted A to Z; switch to Z to A' : 'Sorted Z to A; switch to A to Z'}
                >
                  {az ? <ArrowDownAZ size={15} /> : <ArrowUpAZ size={15} />}
                  {az ? 'A–Z' : 'Z–A'}
                </button>
              </div>
            )}

            {shown.length === 0 ? (
              <div className="empty-state">
                <p>No plan matches “{query}”.</p>
              </div>
            ) : (
              <div className="plan-list">
                {shown.map(p => (
                  <div key={p.id} className="card plan-card plan-card-row">
                    <button className="plan-card-open" onClick={() => onOpen(p.id)}>
                      <div className="plan-card-main">
                        <strong className="plan-card-name">{p.name}</strong>
                        <span className="plan-card-meta plan-num">
                          {p.dayCount} day{p.dayCount === 1 ? '' : 's'}
                          {p.lastSessionAt && ` · last run ${relativeDay(p.lastSessionAt)}`}
                        </span>
                      </div>
                      {p.archived && <span className="plan-badge">Archived</span>}
                    </button>
                    {/* Straight into training, without opening the plan first:
                        the common case is the same day you did last week. */}
                    <button
                      className="btn-icon plan-card-start"
                      onClick={() => startFromList(p)}
                      title={`Start ${p.name}`}
                      aria-label={`Start ${p.name}`}
                      disabled={p.dayCount === 0}
                    >
                      <Play size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <button className="fab" onClick={() => setNaming(true)} title="New plan" aria-label="New plan">
        <Plus size={22} />
      </button>

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
              <Play size={16} aria-hidden />
            </button>
          ))}
        </div>
      </div>
    </Modal>
  )
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
