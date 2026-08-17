import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCheck, History, Loader2, Trash2, X } from 'lucide-react'
import { useRefreshHandler } from '../../context/RefreshContext'
import ConfirmDialog from '../../components/ConfirmDialog'
import { api } from '../../lib/api'
import {
  durationLabel, elapsedMin, sessionWhen, volumeLabel, type PlanSession,
} from '../../data/plans'

/**
 * Every session run, newest first.
 *
 * Each row links into the session as it was — the exercises, the picks and the
 * sets, snapshotted on the day. That is the whole reason history is worth
 * keeping: a plan since rewritten still reads correctly here.
 */
export default function SessionHistory({ onOpen }: { onOpen: (id: string) => void }) {
  const [sessions, setSessions] = useState<PlanSession[] | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Set<string> | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const list = await api.listPlanSessions()
      // Sorted here as well as on the server: the list is read as a timeline,
      // and one row out of order is worse than a slow load.
      setSessions([...list].sort((a, b) => b.startedAt.localeCompare(a.startedAt)))
    } catch {
      setError('Could not load your history.')
      setSessions([])
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useRefreshHandler(load)

  const selecting = selected !== null
  const chosen = useMemo(() => [...(selected ?? [])], [selected])

  function toggle(id: string) {
    setSelected(cur => {
      const next = new Set(cur ?? [])
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function remove() {
    setBusy(true)
    try {
      await api.deletePlanSessions(chosen)
      setSessions(cur => cur?.filter(s => !chosen.includes(s.id)) ?? cur)
      setSelected(null)
      setConfirming(false)
    } catch {
      setError('Could not delete those sessions.')
    } finally {
      setBusy(false)
    }
  }

  if (sessions === null) {
    return <div className="page-loading"><Loader2 size={18} className="spin" /></div>
  }
  if (error) return <div className="status-msg err" role="alert">{error}</div>
  if (sessions.length === 0) {
    return (
      <div className="empty-state">
        <History size={28} aria-hidden />
        <p>No sessions yet.</p>
        <p className="empty-state-hint">
          Start one from a plan and it will be recorded here — including which
          alternatives you picked and the weight you actually used.
        </p>
      </div>
    )
  }

  const allSelected = chosen.length === sessions.length

  return (
    <>
      <div className="plan-history-bar">
        {selecting ? (
          <>
            <span className="plan-num">{chosen.length} selected</span>
            <button
              className="btn btn-ghost"
              onClick={() => setSelected(allSelected ? new Set() : new Set(sessions.map(s => s.id)))}
            >
              <CheckCheck size={14} /> {allSelected ? 'Select none' : 'Select all'}
            </button>
            <button
              className="btn btn-danger"
              disabled={chosen.length === 0}
              onClick={() => setConfirming(true)}
            >
              <Trash2 size={14} /> Delete
            </button>
            <button className="btn-icon" onClick={() => setSelected(null)} aria-label="Leave selection">
              <X size={16} />
            </button>
          </>
        ) : (
          <button className="btn btn-ghost" onClick={() => setSelected(new Set())}>
            <CheckCheck size={14} /> Select
          </button>
        )}
      </div>

      <div className="plan-list">
        {sessions.map(s => {
          const finished = !!s.finishedAt
          const picked = selected?.has(s.id) ?? false
          return (
            <button
              key={s.id}
              className={`card plan-card${picked ? ' picked' : ''}`}
              onClick={() => (selecting ? toggle(s.id) : onOpen(s.id))}
              aria-pressed={selecting ? picked : undefined}
            >
              {selecting && (
                <span className="plan-pick" aria-hidden>{picked && <CheckCheck size={14} />}</span>
              )}
              <div className="plan-card-main">
                <strong className="plan-card-name">
                  {s.dayName}
                  {!finished && <span className="plan-badge running">In progress</span>}
                </strong>
                {/* Weekday and time, not just a date: "Sunday morning" is how
                    people remember a session, and it is what makes two
                    sessions on one day tell themselves apart. */}
                <span className="plan-card-meta plan-num">
                  {sessionWhen(s.startedAt)} · {s.planName}
                </span>
              </div>
              <div className="plan-card-figures plan-num">
                <span>{s.doneSets}/{s.totalSets} sets</span>
                <span>{volumeLabel(s.volumeKg)}</span>
                <span>{durationLabel(elapsedMin(s.startedAt, s.finishedAt))}</span>
              </div>
            </button>
          )
        })}
      </div>

      {confirming && (
        <ConfirmDialog
          title={`Delete ${chosen.length} session${chosen.length === 1 ? '' : 's'}?`}
          message="Their records go for good, including the sets and weights. The plans they came from are not touched."
          confirmLabel="Delete"
          danger
          busy={busy}
          onConfirm={remove}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  )
}
