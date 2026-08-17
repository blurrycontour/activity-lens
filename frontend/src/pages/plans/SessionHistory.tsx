import { useCallback, useEffect, useState } from 'react'
import { History, Loader2 } from 'lucide-react'
import { useRefreshHandler } from '../../context/RefreshContext'
import { api } from '../../lib/api'
import { durationLabel, elapsedMin, volumeLabel, type PlanSession } from '../../data/plans'

/**
 * Every session run, newest first.
 *
 * Each row is a link into the session as it was — the exercises, the picks and
 * the sets, snapshotted on the day. That is the whole reason history is worth
 * keeping: a plan that has since been rewritten still reads correctly here.
 */
export default function SessionHistory({ onOpen }: { onOpen: (id: string) => void }) {
  const [sessions, setSessions] = useState<PlanSession[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setSessions(await api.listPlanSessions())
    } catch {
      setError('Could not load your history.')
      setSessions([])
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useRefreshHandler(load)

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

  return (
    <div className="plan-list">
      {sessions.map(s => {
        const finished = !!s.finishedAt
        return (
          <button key={s.id} className="card plan-card" onClick={() => onOpen(s.id)}>
            <div className="plan-card-main">
              <strong className="plan-card-name">
                {s.dayName}
                {!finished && <span className="plan-badge running">In progress</span>}
              </strong>
              <span className="plan-card-meta plan-num">
                {new Date(s.startedAt).toLocaleDateString()} · {s.planName}
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
  )
}
