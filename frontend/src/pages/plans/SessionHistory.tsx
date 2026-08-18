import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, CheckCheck, History, Loader2 } from 'lucide-react'
import { useRefreshHandler } from '../../context/RefreshContext'
import ConfirmDialog from '../../components/ConfirmDialog'
import ListTools from './ListTools'
import { useLongPress } from '../../lib/useLongPress'
import { useSelection } from '../../lib/useSelection'
import { api } from '../../lib/api'
import {
  clockLabel, elapsedSec, sessionWhen, type PlanSession,
} from '../../data/plans'
import { sessionHaystack } from '../../lib/discoverSearch'

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
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [newestFirst, setNewestFirst] = useState(true)

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

  // The app-wide selection behaviour, back gesture and all.
  const { selected, selecting, ids: chosen, count, start, stop, toggle, setSelected } = useSelection<string>()

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matched = (sessions ?? []).filter(s => !q || sessionHaystack(s).includes(q))
    // Sorted here as well as on the server: the list is read as a timeline,
    // and one row out of order is worse than a slow load.
    return matched.sort((a, b) =>
      a.startedAt.localeCompare(b.startedAt) * (newestFirst ? -1 : 1))
  }, [sessions, query, newestFirst])

  /**
   * A session still running cannot be deleted from here.
   *
   * Deleting it would leave the runner holding a session the server has
   * forgotten, and the way to end one is to finish or stop it — a decision that
   * belongs on the session, not in a list where it is one row among many.
   */
  const deletable = useCallback((s: PlanSession) => !!s.finishedAt, [])

  async function remove() {
    setBusy(true)
    try {
      await api.deletePlanSessions(chosen)
      setSessions(cur => cur?.filter(s => !chosen.includes(s.id)) ?? cur)
      stop()
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

  const selectable = shown.filter(deletable)
  const allSelected = selectable.length > 0 && selectable.every(s => selected?.has(s.id))

  return (
    <>
      <ListTools
        query={query}
        onQuery={setQuery}
        placeholder="Search sessions…"
        label="Search sessions"
        sort={
          <button
            className="btn btn-ghost plan-sort"
            onClick={() => setNewestFirst(v => !v)}
            aria-label={newestFirst ? 'Newest first; switch to oldest first' : 'Oldest first; switch to newest first'}
          >
            {newestFirst ? <ArrowDown size={15} /> : <ArrowUp size={15} />}
            {newestFirst ? 'Newest' : 'Oldest'}
          </button>
        }
        noun="sessions"
        selecting={selecting}
        count={count}
        total={selectable.length}
        allSelected={allSelected}
        onSelect={() => start()}
        onToggleAll={() => setSelected(allSelected ? new Set() : new Set(selectable.map(s => s.id)))}
        onDelete={() => setConfirming(true)}
        onCancel={() => stop()}
      />

      {shown.length === 0 ? (
        <div className="empty-state"><p>No session matches “{query}”.</p></div>
      ) : (
        <div className="plan-list">
          {shown.map(s => (
            <SessionRow
              key={s.id}
              session={s}
              selecting={selecting}
              picked={selected?.has(s.id) ?? false}
              canSelect={deletable(s)}
              onOpen={() => onOpen(s.id)}
              onToggle={() => toggle(s.id)}
              onLongPress={() => start(s.id)}
            />
          ))}
        </div>
      )}

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

/**
 * One session in the list.
 *
 * Holding it enters selection; tapping opens it, or picks it while selecting.
 */
function SessionRow({ session: s, selecting, picked, canSelect, onOpen, onToggle, onLongPress }: {
  session: PlanSession
  selecting: boolean
  picked: boolean
  canSelect: boolean
  onOpen: () => void
  onToggle: () => void
  onLongPress: () => void
}) {
  // Hooks cannot be skipped, so the guard is inside the callback rather than
  // around the hook: holding a row does nothing once selection is already open.
  const press = useLongPress(() => { if (!selecting && canSelect) onLongPress() })
  const finished = !!s.finishedAt
  const inert = selecting && !canSelect

  return (
    <button
      className={`card plan-card${picked ? ' picked' : ''}${inert ? ' inert' : ''}`}
      onClick={() => {
        if (press.consumedClick()) return
        if (selecting) { if (canSelect) onToggle() } else onOpen()
      }}
      {...press.handlers}
      aria-pressed={selecting && canSelect ? picked : undefined}
      title={inert ? 'Finish or stop this session before deleting it' : undefined}
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
        <span>{clockLabel(elapsedSec(s.startedAt, s.finishedAt))}</span>
      </div>
    </button>
  )
}
