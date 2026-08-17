import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, CheckCheck, History, Loader2, Trash2, X } from 'lucide-react'
import { useRefreshHandler } from '../../context/RefreshContext'
import ConfirmDialog from '../../components/ConfirmDialog'
import SearchInput from '../../components/SearchInput'
import { api } from '../../lib/api'
import {
  clockLabel, elapsedSec, sessionWhen, volumeLabel, type PlanSession,
} from '../../data/plans'

/** How long a press has to last on a phone before it means "select". */
const LONG_PRESS_MS = 500
/** How far a finger may drift during that press and still count as holding. */
const MOVE_SLOP = 10

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

  const selecting = selected !== null
  const chosen = useMemo(() => [...(selected ?? [])], [selected])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matched = (sessions ?? []).filter(s =>
      !q || s.dayName.toLowerCase().includes(q) || s.planName.toLowerCase().includes(q))
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

  const selectable = shown.filter(deletable)
  const allSelected = selectable.length > 0 && selectable.every(s => selected?.has(s.id))

  return (
    <>
      <div className="discover-tools">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search sessions…"
          label="Search sessions"
          minWidth={160}
        />
        <button
          className="btn btn-ghost"
          onClick={() => setNewestFirst(v => !v)}
          aria-label={newestFirst ? 'Newest first; switch to oldest first' : 'Oldest first; switch to newest first'}
        >
          {newestFirst ? <ArrowDown size={15} /> : <ArrowUp size={15} />}
          {newestFirst ? 'Newest' : 'Oldest'}
        </button>
        {/* On a desktop there is room for it always. On a phone the row is
            already a search field and a sort, and selecting is reached by
            holding a session — which is where a phone user looks for it. */}
        {!selecting && (
          <button className="btn btn-ghost desktop-only" onClick={() => setSelected(new Set())}>
            <CheckCheck size={14} /> Select
          </button>
        )}
      </div>

      {selecting && (
        <div className="plan-history-bar">
          <span className="plan-num">{chosen.length} selected</span>
          <button
            className="btn btn-ghost"
            onClick={() => setSelected(allSelected ? new Set() : new Set(selectable.map(s => s.id)))}
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
        </div>
      )}

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
              onLongPress={() => setSelected(new Set([s.id]))}
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
 * Holding it enters selection, which is the phone gesture for this everywhere
 * else on the platform. The timer is cancelled by any movement, so a press that
 * turns into a scroll — the usual way a list is touched — never selects.
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
  const timer = useRef<number | null>(null)
  const held = useRef(false)
  const from = useRef<{ x: number; y: number } | null>(null)

  const cancel = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
    from.current = null
  }, [])

  useEffect(() => cancel, [cancel])

  function onPointerDown(e: React.PointerEvent) {
    if (selecting || !canSelect) return
    held.current = false
    from.current = { x: e.clientX, y: e.clientY }
    timer.current = window.setTimeout(() => {
      held.current = true
      onLongPress()
    }, LONG_PRESS_MS)
  }

  /**
   * Movement cancels the press — but only real movement.
   *
   * A finger resting on a screen reports a pixel of drift constantly, so
   * cancelling on any pointermove meant the long press essentially never
   * fired. The threshold is what separates holding still from starting to
   * scroll, which is how this list is usually touched.
   */
  function onPointerMove(e: React.PointerEvent) {
    const start = from.current
    if (!start) return
    if (Math.abs(e.clientX - start.x) > MOVE_SLOP || Math.abs(e.clientY - start.y) > MOVE_SLOP) cancel()
  }

  const finished = !!s.finishedAt
  const inert = selecting && !canSelect

  return (
    <button
      className={`card plan-card${picked ? ' picked' : ''}${inert ? ' inert' : ''}`}
      onClick={() => {
        // The press that opened selection must not also open the session.
        if (held.current) { held.current = false; return }
        if (selecting) { if (canSelect) onToggle() } else onOpen()
      }}
      onPointerDown={onPointerDown}
      onPointerUp={cancel}
      onPointerMove={onPointerMove}
      onPointerCancel={cancel}
      onContextMenu={e => e.preventDefault()}
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
        <span>{volumeLabel(s.volumeKg)}</span>
        <span>{clockLabel(elapsedSec(s.startedAt, s.finishedAt))}</span>
      </div>
    </button>
  )
}
