import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Timer, X } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import ConfirmDialog from '../../components/ConfirmDialog'
import { api } from '../../lib/api'
import {
  blockComplete, chosen, doneSets, durationLabel, elapsedMin, sessionTally,
  targetLabel, trimNum, volumeLabel,
  type PlanBlock, type PlanSession, type SessionProgress,
} from '../../data/plans'
import { cacheProgress, clearCachedProgress, readCachedProgress } from './sessionCache'

interface Props {
  session: PlanSession
  onFinished: (s: PlanSession) => void
  onDiscarded: () => void
  onBack: () => void
}

/**
 * Running a session: the whole day as a list of rows, sets as tappable
 * squares, one row expandable into the big view.
 *
 * The list is the primary form because the question you ask most in a gym is
 * "what is left", and a list answers it without an interaction. The expanded
 * row is for the set you are actually in the middle of: numbers you can read
 * from the floor, the weight you really used, and somewhere for the rest timer
 * to live. One row is open at a time — two would be a list again, with worse
 * density.
 */
export default function SessionRunner({ session, onFinished, onDiscarded, onBack }: Props) {
  const [progress, setProgress] = useState<SessionProgress>(() => {
    // A session picked up after the app was killed has whatever the last tick
    // wrote locally, which is newer than whatever reached the server.
    const cached = readCachedProgress(session.id)
    return cached ?? session.progress
  })
  const [openBlock, setOpenBlock] = useState<string | null>(null)
  const [confirmFinish, setConfirmFinish] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const blocks = session.snapshot.blocks
  const tally = useMemo(
    () => sessionTally({ ...session, progress }),
    [session, progress],
  )
  const pct = tally.total ? Math.round(tally.done / tally.total * 100) : 0

  // --- persistence -------------------------------------------------------
  //
  // Every change is written to local storage synchronously and pushed to the
  // server on a short debounce. The local write is what makes a killed app
  // resumable; the debounce is what stops a set of five ticks being five
  // requests. Which one is authoritative is decided on load, above.
  const saveTimer = useRef<number | null>(null)
  const latest = useRef(progress)
  latest.current = progress

  const push = useCallback(() => {
    api.savePlanProgress(session.id, latest.current).catch(() => {
      // Deliberately quiet: the local copy is intact, the next tick retries,
      // and finishing sends the whole progress again. A toast per failed
      // autosave would be noise in exactly the place — a gym, on bad signal —
      // where it is least welcome.
    })
  }, [session.id])

  const update = useCallback((next: SessionProgress) => {
    setProgress(next)
    cacheProgress(session.id, next)
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(push, 1500)
  }, [push, session.id])

  // A backgrounded tab may never run the pending timer, and on a phone
  // "backgrounded" is what happens on the way to the next exercise.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState !== 'hidden') return
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      push()
    }
    document.addEventListener('visibilitychange', flush)
    return () => {
      document.removeEventListener('visibilitychange', flush)
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [push])

  // --- edits -------------------------------------------------------------

  function blockProgress(block: PlanBlock) {
    return progress.blocks[block.id] ?? { pick: 0, sets: [] }
  }

  function toggleSet(block: PlanBlock, index: number) {
    const current = blockProgress(block)
    const sets = [...current.sets]
    while (sets.length <= index) sets.push({ done: false, weightKg: 0 })
    sets[index] = { ...sets[index], done: !sets[index].done }
    update({ blocks: { ...progress.blocks, [block.id]: { ...current, sets } } })
  }

  function setWeight(block: PlanBlock, index: number, kg: number) {
    const current = blockProgress(block)
    const sets = [...current.sets]
    while (sets.length <= index) sets.push({ done: false, weightKg: 0 })
    sets[index] = { ...sets[index], weightKg: kg }
    update({ blocks: { ...progress.blocks, [block.id]: { ...current, sets } } })
  }

  function pickOption(block: PlanBlock, index: number) {
    const current = blockProgress(block)
    if (current.pick === index) return
    // Ticks are cleared with the swap: three sets of bench press are not three
    // sets of push-ups, and carrying them over would silently credit work that
    // was not done.
    update({ blocks: { ...progress.blocks, [block.id]: { pick: index, sets: [] } } })
  }

  // --- finishing ---------------------------------------------------------

  async function finish() {
    setBusy(true)
    setError('')
    try {
      const done = await api.finishPlanSession(session.id, progress)
      clearCachedProgress(session.id)
      onFinished(done)
    } catch {
      setError('Could not finish the session. Your sets are saved — try again.')
      setBusy(false)
      setConfirmFinish(false)
    }
  }

  async function discard() {
    setBusy(true)
    try {
      await api.deletePlanSession(session.id)
      clearCachedProgress(session.id)
      onDiscarded()
    } catch {
      setError('Could not discard the session.')
      setBusy(false)
      setConfirmDiscard(false)
    }
  }

  const elapsed = elapsedMin(session.startedAt)

  return (
    <>
      <PageHeader
        title={session.dayName}
        subtitle={session.planName}
        onBack={onBack}
        actions={
          <div className="plan-run-actions">
            <button className="btn btn-ghost" onClick={() => setConfirmDiscard(true)}>Discard</button>
            <button className="btn btn-primary" onClick={() => setConfirmFinish(true)}>
              <Check size={15} /> Finish
            </button>
          </div>
        }
      />

      <div className="page-content">
        {error && <div className="status-msg err" role="alert">{error}</div>}

        <div className="card plan-run-summary">
          <Ring pct={pct} />
          <div className="plan-run-figures">
            <div className="stat-chip">
              <span className="label">Sets</span>
              <span className="value">{tally.done}<span className="unit"> / {tally.total}</span></span>
            </div>
            <div className="stat-chip">
              <span className="label">Elapsed</span>
              <span className="value">{durationLabel(elapsed)}</span>
            </div>
            <div className="stat-chip">
              <span className="label">Volume</span>
              <span className="value">{volumeLabel(liveVolume(blocks, progress))}</span>
            </div>
          </div>
        </div>

        <div className="plan-rows">
          {blocks.map((block, i) => (
            <div key={block.id}>
              <ExerciseRow
                block={block}
                index={i}
                progress={blockProgress(block)}
                open={openBlock === block.id}
                onOpen={() => setOpenBlock(openBlock === block.id ? null : block.id)}
                onToggleSet={n => toggleSet(block, n)}
                onSetWeight={(n, kg) => setWeight(block, n, kg)}
                onPick={n => pickOption(block, n)}
              />
              {/* The planned break before the next exercise. Tapping it starts
                  the countdown — see RestTimer for why nothing starts one by
                  itself. */}
              {block.restSec > 0 && i < blocks.length - 1 && (
                <div className="plan-break-run">
                  <RestTimer seconds={block.restSec} label="Break" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {confirmFinish && (
        <ConfirmDialog
          title="Finish this session?"
          message={
            tally.done < tally.total
              ? `${tally.done} of ${tally.total} sets are ticked. The rest will be recorded as not done.`
              : `All ${tally.total} sets done. Nice.`
          }
          confirmLabel="Finish"
          busy={busy}
          onConfirm={finish}
          onCancel={() => setConfirmFinish(false)}
        />
      )}
      {confirmDiscard && (
        <ConfirmDialog
          title="Discard this session?"
          message="Everything you have ticked will be deleted. The plan itself is not touched."
          confirmLabel="Discard"
          danger
          busy={busy}
          onConfirm={discard}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}
    </>
  )
}

/** Volume so far, for the running total at the top. */
function liveVolume(blocks: PlanBlock[], progress: SessionProgress): number {
  let total = 0
  for (const b of blocks) {
    const p = progress.blocks[b.id]
    const ex = chosen(b, p)
    if (!ex || !p) continue
    const reps = parseInt(ex.reps, 10)
    // Same rule as the server: a held position has no load to total.
    if (!reps || /s|min/i.test(ex.reps)) continue
    p.sets.forEach((s, i) => {
      if (!s.done || i >= ex.sets) return
      total += (s.weightKg || ex.weightKg) * reps
    })
  }
  return total
}

function Ring({ pct }: { pct: number }) {
  const r = 26
  const c = 2 * Math.PI * r
  return (
    <div className="plan-ring" role="img" aria-label={`${pct}% of sets done`}>
      <svg width="62" height="62" viewBox="0 0 62 62">
        <circle cx="31" cy="31" r={r} fill="none" stroke="var(--bg-3)" strokeWidth="5" />
        <circle
          cx="31" cy="31" r={r} fill="none" stroke="var(--primary)" strokeWidth="5"
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)}
          transform="rotate(-90 31 31)"
        />
      </svg>
      <span className="plan-ring-num">{pct}%</span>
    </div>
  )
}

interface RowProps {
  block: PlanBlock
  index: number
  progress: { pick: number; sets: { done: boolean; weightKg: number }[] }
  open: boolean
  onOpen: () => void
  onToggleSet: (n: number) => void
  onSetWeight: (n: number, kg: number) => void
  onPick: (n: number) => void
}

function ExerciseRow({ block, index, progress, open, onOpen, onToggleSet, onSetWeight, onPick }: RowProps) {
  const ex = chosen(block, progress)
  if (!ex) return null
  const complete = blockComplete(block, progress)
  const done = doneSets(block, progress)

  return (
    <div className={`plan-ex${complete ? ' done' : ''}${open ? ' open' : ''}`}>
      <div className="plan-ex-top">
        <button
          className="plan-ex-name"
          onClick={onOpen}
          aria-expanded={open}
          aria-label={`${ex.name}, ${done} of ${ex.sets} sets done`}
        >
          <span className="plan-ex-index">{index + 1}</span>
          <span className="plan-ex-title">{ex.name}</span>
          <ChevronDown size={15} className="plan-ex-caret" />
        </button>
        <div className="plan-ex-target plan-num">
          {targetLabel(ex)}
        </div>
      </div>

      {/* Compact: the sets as squares. The row you are working on opens into
          the big view below instead. */}
      {!open && (
        <div className="plan-sets">
          {Array.from({ length: ex.sets }, (_, n) => (
            <button
              key={n}
              className="plan-set"
              aria-pressed={!!progress.sets[n]?.done}
              aria-label={`Set ${n + 1} of ${ex.name}`}
              onClick={() => onToggleSet(n)}
            >
              {n + 1}
            </button>
          ))}
        </div>
      )}

      {open && (
        <div className="plan-ex-focus">
          <div className="plan-focus-targets">
            <div className="stat-chip">
              <span className="label">Sets</span>
              <span className="value">{ex.sets}</span>
            </div>
            <div className="stat-chip">
              <span className="label">Reps</span>
              <span className="value">{ex.reps || '—'}</span>
            </div>
            <div className="stat-chip">
              <span className="label">Target</span>
              <span className="value">
                {ex.weightKg > 0 ? trimNum(ex.weightKg) : '—'}
                {ex.weightKg > 0 && <span className="unit"> kg</span>}
              </span>
            </div>
          </div>

          <div className="plan-setrows">
            {Array.from({ length: ex.sets }, (_, n) => {
              const log = progress.sets[n]
              return (
                <div key={n} className={`plan-setrow${log?.done ? ' done' : ''}`}>
                  <button
                    className="plan-setrow-tick"
                    aria-pressed={!!log?.done}
                    aria-label={`Set ${n + 1}`}
                    onClick={() => onToggleSet(n)}
                  >
                    <Check size={15} />
                  </button>
                  <span className="plan-setrow-n">Set {n + 1}</span>
                  <span className="plan-setrow-reps plan-num">{ex.reps}</span>
                  {/* The actual weight, defaulting to the target. The last set
                      is often lighter, and a plan that can only hold the plan
                      turns a drop set into a lie. */}
                  <label className="plan-setrow-kg">
                    <input
                      type="number"
                      inputMode="decimal"
                      className="input"
                      step="0.5"
                      min="0"
                      value={log?.weightKg || ex.weightKg || ''}
                      placeholder="—"
                      aria-label={`Weight used for set ${n + 1}, kilograms`}
                      onChange={e => onSetWeight(n, parseFloat(e.target.value) || 0)}
                    />
                    <span>kg</span>
                  </label>
                </div>
              )
            })}
          </div>

          {ex.restSec > 0 && <RestTimer seconds={ex.restSec} />}
          {ex.note && <p className="plan-ex-note">{ex.note}</p>}
        </div>
      )}

      {block.options.length > 1 && (
        <div className="plan-alt">
          <span className="field-label">Or</span>
          {block.options.map((opt, n) => (
            <button
              key={opt.id}
              className={`plan-swap${progress.pick === n ? ' on' : ''}`}
              onClick={() => onPick(n)}
              aria-pressed={progress.pick === n}
            >
              {opt.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * A rest countdown, started by hand.
 *
 * Not started automatically on the last tick: people tick a set late, tick two
 * at once, or tick one they did five minutes ago, and a timer that starts
 * itself at those moments is wrong more often than right.
 */
function RestTimer({ seconds, label = 'Rest' }: { seconds: number; label?: string }) {
  const [left, setLeft] = useState<number | null>(null)

  useEffect(() => {
    if (left === null) return
    if (left <= 0) return
    const id = window.setTimeout(() => setLeft(left - 1), 1000)
    return () => window.clearTimeout(id)
  }, [left])

  if (left === null) {
    return (
      <button className="plan-rest" onClick={() => setLeft(seconds)}>
        <Timer size={14} /> {label} {formatRest(seconds)}
      </button>
    )
  }
  return (
    <div className={`plan-rest running${left <= 0 ? ' up' : ''}`}>
      <Timer size={14} />
      {left > 0 ? formatRest(left) : `${label} over`}
      <button className="btn-icon" onClick={() => setLeft(null)} aria-label="Stop the rest timer">
        <X size={14} />
      </button>
    </div>
  )
}

function formatRest(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
