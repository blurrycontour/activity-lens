import { useCallback, useEffect, useState } from 'react'
import { ClipboardList, History, Loader2, Play, Plus, X } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import TabStrip from '../../components/TabStrip'
import Modal from '../../components/Modal'
import { useRefreshHandler } from '../../context/RefreshContext'
import PlanEditor from './PlanEditor'
import SessionRunner from './SessionRunner'
import SessionHistory from './SessionHistory'
import { api } from '../../lib/api'
import { durationLabel, elapsedMin, volumeLabel, type PlanSession, type TrainingPlan } from '../../data/plans'
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
 * Three surfaces sharing one route: the list, the editor for one plan, and the
 * runner for a session. They are here rather than in three pages because the
 * navigation between them is a back arrow, not a page change — and because the
 * running session has to be reachable from anywhere, which means one component
 * owning "what is open".
 */
export default function PlansPage({ section, detail, onOpen }: Props) {
  const [plans, setPlans] = useState<TrainingPlan[] | null>(null)
  const [active, setActive] = useState<PlanSession | null>(null)
  const [open, setOpen] = useState<TrainingPlan | null>(null)
  const [session, setSession] = useState<PlanSession | null>(null)
  const [tab, setTab] = useState<TabId>('plans')
  const [error, setError] = useState('')
  const [naming, setNaming] = useState(false)
  const [creating, setCreating] = useState(false)

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
  // Pull to refresh, and the desktop refresh button. Without this the page
  // showed whatever it had when it mounted — including no sign of a plan
  // written on another device.
  useRefreshHandler(load)

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
    }
    return () => { cancelled = true }
  }, [section, detail, onOpen])

  /**
   * Creating asks for the name first, and only then writes anything.
   *
   * It used to create a plan called "New plan" the moment the button was
   * tapped, which left one behind for every accidental press — a row that was
   * never wanted and had to be deleted by hand. Nothing exists until there is
   * a name to give it.
   */
  async function createPlan(name: string) {
    setCreating(true)
    try {
      const p = await api.createPlan({ name })
      setNaming(false)
      setPlans(cur => [p, ...(cur ?? [])])
      onOpen(p.id)
    } catch {
      setError('Could not create the plan.')
    } finally {
      setCreating(false)
    }
  }

  async function start(planId: string, dayId: string) {
    try {
      const s = await api.startPlanSession(planId, dayId)
      // A fresh session starts with no local ticks; a stale cache from a
      // discarded one would otherwise be read back into it.
      clearCachedProgress()
      setActive(s)
      onOpen('session', s.id)
    } catch (e) {
      setError(e instanceof Error && e.message.includes('already running')
        ? 'A session is already running. Finish or discard it first.'
        : 'Could not start the session.')
    }
  }

  // --- the runner --------------------------------------------------------
  if (session && !session.finishedAt) {
    return (
      <SessionRunner
        session={session}
        onBack={() => onOpen(null)}
        onFinished={s => { setActive(null); setSession(null); void load(); onOpen('session', s.id) }}
        onDiscarded={() => { setActive(null); setSession(null); void load(); onOpen(null) }}
      />
    )
  }
  if (session) {
    return <FinishedSession session={session} onBack={() => onOpen(null)} />
  }

  // --- one plan ----------------------------------------------------------
  if (open) {
    return (
      <PlanEditor
        plan={open}
        onBack={() => onOpen(null)}
        onStart={dayId => start(open.id, dayId)}
        onDeleted={() => { void load(); onOpen(null) }}
        onSaved={saved => {
          setOpen(saved)
          setPlans(cur => cur?.map(p => (p.id === saved.id ? { ...saved, days: undefined } : p)) ?? cur)
        }}
      />
    )
  }

  // --- the list ----------------------------------------------------------
  return (
    <>
      <PageHeader
        title="Plans"
        subtitle="Your training routines"
        /* Desktop only; the phone gets the floating button below, which is
           where the thumb already is on the Workouts page. */
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
          <div className="plan-list">
            {plans.map(p => (
              <button key={p.id} className="card plan-card" onClick={() => onOpen(p.id)}>
                <div className="plan-card-main">
                  <strong className="plan-card-name">{p.name}</strong>
                  <span className="plan-card-meta plan-num">
                    {p.dayCount} day{p.dayCount === 1 ? '' : 's'}
                    {p.lastSessionAt && ` · last run ${relativeDay(p.lastSessionAt)}`}
                  </span>
                </div>
                {p.archived && <span className="plan-badge">Archived</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <button className="fab" onClick={() => setNaming(true)} title="New plan" aria-label="New plan">
        <Plus size={22} />
      </button>

      {naming && (
        <NamePlanDialog busy={creating} onCancel={() => setNaming(false)} onCreate={createPlan} />
      )}
    </>
  )
}

/** Asks for a name, so that nothing is written until there is one. */
function NamePlanDialog({ busy, onCreate, onCancel }: {
  busy: boolean
  onCreate: (name: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  return (
    <Modal onClose={onCancel} label="New plan">
      <form
        className="modal-box"
        style={{ maxWidth: 420 }}
        onSubmit={e => { e.preventDefault(); if (name.trim()) onCreate(name.trim()) }}
      >
        <div className="dialog-head">
          <h3 style={{ fontSize: 16, fontWeight: 700 }}>New plan</h3>
          <button type="button" className="btn-icon" onClick={onCancel} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <label className="form-label" htmlFor="new-plan-name">Plan name</label>
        <input
          id="new-plan-name"
          className="input"
          value={name}
          autoFocus
          placeholder="Push / Pull / Legs"
          onChange={e => setName(e.target.value)}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim() || busy}>
            {busy ? <Loader2 size={15} className="spin" /> : <Plus size={15} />} Create
          </button>
        </div>
      </form>
    </Modal>
  )
}

/** A finished session, read back from history. */
function FinishedSession({ session, onBack }: { session: PlanSession; onBack: () => void }) {
  const minutes = elapsedMin(session.startedAt, session.finishedAt)
  return (
    <>
      <PageHeader
        title={session.dayName}
        subtitle={`${session.planName} · ${new Date(session.startedAt).toLocaleDateString()}`}
        onBack={onBack}
      />
      <div className="page-content">
        <div className="card plan-run-summary">
          <div className="plan-run-figures">
            <div className="stat-chip">
              <span className="label">Sets</span>
              <span className="value">{session.doneSets}<span className="unit"> / {session.totalSets}</span></span>
            </div>
            <div className="stat-chip">
              <span className="label">Time</span>
              <span className="value">{durationLabel(minutes)}</span>
            </div>
            <div className="stat-chip">
              <span className="label">Volume</span>
              <span className="value">{volumeLabel(session.volumeKg)}</span>
            </div>
          </div>
        </div>

        {/* The plan as it was on the day, not as it is now. */}
        <p className="field-label plan-snapshot-note">The plan as it was that day</p>
        <div className="plan-rows">
          {session.snapshot.blocks.map(b => {
            const p = session.progress.blocks[b.id]
            const ex = b.options[p?.pick ?? 0] ?? b.options[0]
            if (!ex) return null
            const done = (p?.sets ?? []).filter((s, i) => s.done && i < ex.sets).length
            return (
              <div key={b.id} className={`plan-ex${done >= ex.sets ? ' done' : ''}`}>
                <div className="plan-ex-top">
                  <span className="plan-ex-title">{ex.name}</span>
                  <div className="plan-ex-target plan-num">{done} / {ex.sets} sets</div>
                </div>
              </div>
            )
          })}
        </div>

        {session.notes && <p className="plan-session-notes">{session.notes}</p>}
      </div>
    </>
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
