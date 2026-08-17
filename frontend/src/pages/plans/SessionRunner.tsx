import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronsDownUp, ChevronsUpDown, Square, Timer, X } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import ConfirmDialog from '../../components/ConfirmDialog'
import { api } from '../../lib/api'
import {
  blockComplete, blockLabel, blockProgress, chosenExercises, clockLabel, currentExercise,
  doneSetsFor, durationShort, effectivePicks, elapsedSec, exerciseComplete, leadingDone,
  sessionTally, sessionVolume, setTappable, setsFor, targetLabel, trimNum, volumeLabel,
  type BlockProgress, type PlanBlock, type PlanExercise, type PlanSession, type SessionProgress, type SetLog,
} from '../../data/plans'
import { cacheProgress, clearCachedProgress, readCachedProgress } from './sessionCache'
import { clearSessionNotice, showSessionNotice } from '../../lib/native/sessionNotice'

interface Props {
  session: PlanSession
  onFinished: (s: PlanSession) => void
  onDiscarded: () => void
  onBack: () => void
}

/** A countdown in flight: what is resting, and when it is over. */
interface Rest {
  /** `ex:<id>` for the rest between sets, `break:<id>` for one between blocks. */
  key: string
  until: number
  seconds: number
}

const exKey = (ex: PlanExercise) => `ex:${ex.id}`
const breakKey = (block: PlanBlock) => `break:${block.id}`

/**
 * Running a session: the whole day as a list of rows, sets as tappable
 * squares, rows expandable into the big view.
 *
 * The list is the primary form because the question you ask most in a gym is
 * "what is left", and a list answers it without an interaction. An expanded row
 * is for the set you are in the middle of: numbers you can read from the floor,
 * the weight you really used, and the rest timer.
 */
export default function SessionRunner({ session, onFinished, onDiscarded, onBack }: Props) {
  const [progress, setProgress] = useState<SessionProgress>(() => {
    // A session picked up after the app was killed has whatever the last tick
    // wrote locally, which is newer than whatever reached the server.
    const cached = readCachedProgress(session.id)
    return cached ?? session.progress
  })
  // A set of ids rather than one id: "expand all" is a real request in a gym,
  // where you want to read the whole day at once before you start.
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  const [confirmFinish, setConfirmFinish] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // One countdown at a time: you are only ever between sets of one thing, or
  // between one block and the next.
  const [rest, setRest] = useState<Rest | null>(null)

  const blocks = session.snapshot.blocks
  const tally = useMemo(() => sessionTally({ ...session, progress }), [session, progress])
  const pct = tally.total ? Math.round(tally.done / tally.total * 100) : 0
  const allOpen = openIds.size === blocks.length && blocks.length > 0

  // A clock in the header has to move. One interval for the page rather than
  // one per timer, so a long day does not accumulate them.
  const [, tick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => tick(n => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [])

  // The phone's ongoing notification, so a session is visible with the app
  // closed. Re-posted as progress moves: the shade should say how far in you
  // are and what you are on, not just that something is running. A no-op
  // anywhere but the Android app.
  const heading = currentExercise(session, progress)
  useEffect(() => {
    void showSessionNotice({
      sessionId: session.id,
      title: session.dayName,
      body: heading ? `${pct}% · ${heading}` : `${pct}% · ${session.planName}`,
      startedAt: session.startedAt,
      percent: pct,
    })
  }, [session.id, session.dayName, session.planName, session.startedAt, heading, pct])

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

  function startRest(key: string, seconds: number) {
    if (seconds > 0) setRest({ key, until: Date.now() + seconds * 1000, seconds })
  }

  function patchSets(block: PlanBlock, ex: PlanExercise, index: number, change: Partial<SetLog>) {
    const current = blockProgress(progress, block.id)
    const sets = [...setsFor(current, ex.id)]
    while (sets.length <= index) sets.push({ done: false, weightKg: 0 })
    sets[index] = { ...sets[index], ...change }
    const next: BlockProgress = { ...current, sets: { ...current.sets, [ex.id]: sets } }
    update({ blocks: { ...progress.blocks, [block.id]: next } })
    return next
  }

  /**
   * Ticking a set, in order.
   *
   * Only the next undone set and the last done one respond, so progress is
   * always a run from the start. Set 3 ticked before sets 1 and 2 recorded a
   * session nobody performed, and made every timing derived from it — the gap
   * between sets, the rest that starts on a tick — describe nothing.
   */
  function toggleSet(block: PlanBlock, ex: PlanExercise, index: number) {
    const sets = setsFor(blockProgress(progress, block.id), ex.id)
    if (!setTappable(sets, index)) return
    const wasDone = !!sets[index]?.done

    const after = patchSets(block, ex, index, {
      done: !wasDone,
      // Stamped as it happens, so history can show what the session actually
      // looked like rather than only its start and end.
      at: !wasDone ? new Date().toISOString() : undefined,
    })
    if (wasDone) {
      setRest(null)
      return
    }

    // Finishing a block starts the break before the next one — that is the
    // moment it begins, and waiting for a tap meant the break was usually
    // remembered halfway through it. Otherwise the rest between sets runs.
    const isLast = blocks[blocks.length - 1]?.id === block.id
    if (block.restSec > 0 && !isLast && blockComplete(block, after)) {
      startRest(breakKey(block), block.restSec)
    } else if (ex.restSec > 0) {
      startRest(exKey(ex), ex.restSec)
    }
  }

  /**
   * Choosing which of a block's options to do.
   *
   * A choose-one block swaps; a "2 of 3" or a superset toggles membership up
   * to its limit. Nothing is ever cleared: the sets are kept per exercise, so
   * changing your mind and changing it back costs nothing.
   */
  function togglePick(block: PlanBlock, index: number) {
    const required = Math.min(Math.max(block.required || 1, 1), block.options.length)
    const p = blockProgress(progress, block.id)
    const current = effectivePicks(block, p)
    let picks: number[]
    if (required <= 1) {
      picks = [index]
    } else if (current.includes(index)) {
      const without = current.filter(i => i !== index)
      // Never below one: an empty block would have nothing to show.
      picks = without.length ? without : current
    } else {
      // Drop the oldest to make room once the block is full, so tapping a
      // third option in a "2 of 3" does the obvious thing.
      picks = current.length >= required ? [...current.slice(1), index] : [...current, index]
    }
    update({ blocks: { ...progress.blocks, [block.id]: { ...p, picks } } })
  }

  function toggleOpen(id: string) {
    setOpenIds(cur => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // --- finishing ---------------------------------------------------------

  async function finish() {
    setBusy(true)
    setError('')
    try {
      const done = await api.finishPlanSession(session.id, progress)
      clearCachedProgress(session.id)
      void clearSessionNotice()
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
      void clearSessionNotice()
      onDiscarded()
    } catch {
      setError('Could not discard the session.')
      setBusy(false)
      setConfirmDiscard(false)
    }
  }

  return (
    <>
      <PageHeader
        /* The live dot in the title, not only on the list two screens away:
           this page looks much like a plan being read, and "is this recording"
           is the one thing it must answer without being asked. */
        title={session.dayName}
        titleAction={<span className="plan-live-dot" role="img" aria-label="Session in progress" />}
        subtitle={`${session.planName} · recording`}
        onBack={onBack}
        actions={
          <div className="plan-run-actions desktop-only">
            <button className="btn btn-ghost" onClick={() => setConfirmDiscard(true)}>
              <Square size={14} /> Stop
            </button>
            <button className="btn btn-primary" onClick={() => setConfirmFinish(true)}>
              <Check size={15} /> Finish
            </button>
          </div>
        }
      />

      <div className="page-content plan-run-page">
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
              <span className="value plan-num">{clockLabel(elapsedSec(session.startedAt))}</span>
            </div>
            {/* "Volume" is the strength-training term and the one the rest of
                the app already uses, but it means nothing on sight — hence the
                unit under it rather than a label people have to look up. */}
            <div className="stat-chip" title="Total load moved: weight × reps, added up across every set you have ticked">
              <span className="label">Volume lifted</span>
              <span className="value">{volumeLabel(sessionVolume(session, progress))}</span>
            </div>
          </div>
        </div>

        <div className="plan-run-tools">
          <button
            className="btn btn-ghost"
            onClick={() => setOpenIds(allOpen ? new Set() : new Set(blocks.map(b => b.id)))}
          >
            {allOpen ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        </div>

        <div className="plan-rows">
          {blocks.map((block, i) => (
            <div key={block.id}>
              <BlockRow
                block={block}
                index={i}
                progress={blockProgress(progress, block.id)}
                open={openIds.has(block.id)}
                rest={rest}
                onRestDone={() => setRest(null)}
                onStartRest={(ex, secs) => startRest(exKey(ex), secs)}
                onOpen={() => toggleOpen(block.id)}
                onToggleSet={(ex, n) => toggleSet(block, ex, n)}
                onSetChange={(ex, n, change) => patchSets(block, ex, n, change)}
                onPick={n => togglePick(block, n)}
              />
              {/* The planned break before the next exercise. It starts itself
                  the moment the block above is finished. */}
              {block.restSec > 0 && i < blocks.length - 1 && (
                <div className="plan-break-line">
                  <RestTimer
                    seconds={block.restSec}
                    label="Break"
                    until={rest?.key === breakKey(block) ? rest.until : null}
                    onDone={() => setRest(null)}
                    onStart={() => startRest(breakKey(block), block.restSec)}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* The phone's controls, where the thumb is. Finish is the accent; stop
          is the destructive one and wears the danger colour rather than sitting
          next to it looking identical. */}
      <div className="fab-stack">
        <button
          className="fab fab-danger"
          onClick={() => setConfirmDiscard(true)}
          title="Stop and discard"
          aria-label="Stop and discard this session"
        >
          <Square size={19} />
        </button>
        <button
          className="fab"
          onClick={() => setConfirmFinish(true)}
          title="Finish session"
          aria-label="Finish session"
        >
          <Check size={22} />
        </button>
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
          title="Stop and discard this session?"
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
  progress: BlockProgress
  open: boolean
  rest: Rest | null
  onRestDone: () => void
  onStartRest: (ex: PlanExercise, seconds: number) => void
  onOpen: () => void
  onToggleSet: (ex: PlanExercise, index: number) => void
  onSetChange: (ex: PlanExercise, index: number, change: Partial<SetLog>) => void
  onPick: (index: number) => void
}

/**
 * One block in the runner.
 *
 * A choose-one block draws the exercise it is set to; a superset draws each of
 * its exercises in turn, because they are all being done and each needs its
 * own sets.
 */
function BlockRow({ block, index, progress, open, rest, onRestDone, onStartRest, onOpen, onToggleSet, onSetChange, onPick }: RowProps) {
  const chosen = chosenExercises(block, progress)
  if (chosen.length === 0) return null
  const complete = chosen.every(ex => exerciseComplete(ex, setsFor(progress, ex.id)))
  const picked = new Set(effectivePicks(block, progress))
  const label = blockLabel(block)

  return (
    <div className={`plan-ex${complete ? ' done' : ''}${open ? ' open' : ''}${block.options.length > 1 ? ' plan-ex-grouped' : ''}`}>
      <div className="plan-ex-top">
        <button
          className="plan-ex-name"
          onClick={onOpen}
          aria-expanded={open}
          aria-label={`${chosen.map(e => e.name).join(', ')}, ${open ? 'collapse' : 'expand'}`}
        >
          <span className="plan-ex-index">{index + 1}</span>
          <span className="plan-ex-titles">
            {chosen.map(ex => (
              <span key={ex.id} className="plan-ex-title">
                {ex.name}
                {chosen.length > 1 && (
                  <span className="plan-ex-sub plan-num"> {targetLabel(ex)}</span>
                )}
              </span>
            ))}
          </span>
          <ChevronDown size={15} className="plan-ex-caret" />
        </button>
        {chosen.length === 1 && (
          <div className="plan-ex-target plan-num">{targetLabel(chosen[0])}</div>
        )}
      </div>

      {!open && chosen.map(ex => {
        const sets = setsFor(progress, ex.id)
        const next = leadingDone(sets)
        return (
          <div className="plan-sets" key={ex.id}>
            {chosen.length > 1 && <span className="plan-sets-for">{ex.name}</span>}
            {Array.from({ length: ex.sets }, (_, n) => (
              <button
                key={n}
                className="plan-set"
                aria-pressed={!!sets[n]?.done}
                aria-label={`Set ${n + 1} of ${ex.name}`}
                disabled={!setTappable(sets, n)}
                title={setTappable(sets, n) ? undefined : `Do set ${next + 1} first`}
                onClick={() => onToggleSet(ex, n)}
              >
                {n + 1}
              </button>
            ))}
            {/* The rest between sets, on the collapsed row too. It only ever
                showed inside the expanded view, which is the one place you are
                not looking while you wait for it. */}
            {rest?.key === exKey(ex) && (
              <RestTimer seconds={ex.restSec} label="Rest" until={rest.until} onDone={onRestDone} />
            )}
          </div>
        )
      })}

      {open && (
        <div className="plan-ex-focus">
          {chosen.map(ex => (
            <ExerciseDetail
              key={ex.id}
              ex={ex}
              sets={setsFor(progress, ex.id)}
              heading={chosen.length > 1 ? ex.name : undefined}
              rest={rest?.key === exKey(ex) ? rest.until : null}
              onRestDone={onRestDone}
              onStartRest={secs => onStartRest(ex, secs)}
              onToggle={n => onToggleSet(ex, n)}
              onChange={(n, change) => onSetChange(ex, n, change)}
            />
          ))}
        </div>
      )}

      {block.options.length > 1 && (
        <div className="plan-alt">
          <span className="field-label plan-read-kind">{label}</span>
          {block.options.map((opt, n) => {
            const on = picked.has(n)
            const finished = exerciseComplete(opt, setsFor(progress, opt.id))
            const started = doneSetsFor(opt, setsFor(progress, opt.id)) > 0
            return (
              <button
                key={opt.id}
                className={`plan-swap${on ? ' on' : ''}${finished ? ' finished' : ''}`}
                onClick={() => onPick(n)}
                aria-pressed={on}
                title={finished ? `${opt.name} — all sets done` : undefined}
              >
                {/* Done and part-done both matter here: a chip you can switch
                    away from should say whether there is work behind it. */}
                {finished && <Check size={12} aria-hidden />}
                {opt.name}
                {!finished && started && (
                  <span className="plan-swap-count plan-num">
                    {doneSetsFor(opt, setsFor(progress, opt.id))}/{opt.sets}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** The expanded view of one exercise: big targets, per-set rows, rest. */
function ExerciseDetail({ ex, sets, heading, rest, onRestDone, onStartRest, onToggle, onChange }: {
  ex: PlanExercise
  sets: SetLog[]
  heading?: string
  rest: number | null
  onRestDone: () => void
  onStartRest: (seconds: number) => void
  onToggle: (index: number) => void
  onChange: (index: number, change: Partial<SetLog>) => void
}) {
  const timed = ex.kind === 'time'
  return (
    <div className="plan-focus-block">
      {heading && <div className="plan-focus-heading">{heading}</div>}

      <div className="plan-focus-targets">
        <div className="stat-chip">
          <span className="label">Sets</span>
          <span className="value">{ex.sets}</span>
        </div>
        <div className="stat-chip">
          <span className="label">{timed ? 'Duration' : 'Reps'}</span>
          <span className="value">{timed ? durationShort(ex.durationSec) : ex.reps || '—'}</span>
        </div>
        <div className="stat-chip">
          <span className="label">{ex.kind === 'body' ? 'Added' : 'Target'}</span>
          <span className="value">
            {ex.kind === 'time' || ex.weightKg <= 0
              ? (ex.kind === 'body' ? 'body' : '—')
              : <>{trimNum(ex.weightKg)}<span className="unit"> kg</span></>}
          </span>
        </div>
      </div>

      <div className="plan-setrows">
        {Array.from({ length: ex.sets }, (_, n) => {
          const log = sets[n]
          const tappable = setTappable(sets, n)
          return (
            <div key={n} className={`plan-setrow${log?.done ? ' done' : ''}${tappable ? '' : ' locked'}`}>
              <button
                className="plan-setrow-tick"
                aria-pressed={!!log?.done}
                aria-label={`Set ${n + 1}`}
                disabled={!tappable}
                onClick={() => onToggle(n)}
              >
                <Check size={15} />
              </button>
              <span className="plan-setrow-n">Set {n + 1}</span>
              {timed ? (
                <label className="plan-setrow-kg">
                  <input
                    type="number" inputMode="numeric" className="input" min="0" step="5"
                    value={log?.durationSec || ex.durationSec || ''}
                    placeholder="—"
                    aria-label={`Seconds held for set ${n + 1}`}
                    onChange={e => onChange(n, { durationSec: parseInt(e.target.value, 10) || 0 })}
                  />
                  <span>s</span>
                </label>
              ) : (
                <>
                  <span className="plan-setrow-reps plan-num">{ex.reps}</span>
                  {/* The actual weight, defaulting to the target. The last set
                      is often lighter, and a plan that can only hold the plan
                      turns a drop set into a lie. Bodyweight rows carry added
                      load, which is how a weighted pull-up is recorded. */}
                  <label className="plan-setrow-kg">
                    <input
                      type="number" inputMode="decimal" className="input" step="0.5" min="0"
                      value={log?.weightKg || ex.weightKg || ''}
                      placeholder={ex.kind === 'body' ? '+0' : '—'}
                      aria-label={`Weight used for set ${n + 1}, kilograms`}
                      onChange={e => onChange(n, { weightKg: parseFloat(e.target.value) || 0 })}
                    />
                    <span>kg</span>
                  </label>
                </>
              )}
            </div>
          )
        })}
      </div>

      {ex.restSec > 0 && (
        <RestTimer
          seconds={ex.restSec}
          label="Rest"
          // Ticking a set starts this; see toggleSet.
          until={rest}
          onDone={onRestDone}
          onStart={() => onStartRest(ex.restSec)}
        />
      )}
      {ex.note && <p className="plan-ex-note">{ex.note}</p>}
    </div>
  )
}

/**
 * A countdown.
 *
 * Both kinds start themselves: the rest between sets when a set is ticked, the
 * break between blocks when the block above it is finished. Tapping it is the
 * override for when you got there another way — so it is drawn as the button it
 * is, rather than the line of grey text it used to be.
 */
function RestTimer({ seconds, label = 'Rest', until, onDone, onStart }: {
  seconds: number
  label?: string
  /** Epoch milliseconds the rest ends at, or null when not running. */
  until?: number | null
  onDone?: () => void
  onStart?: () => void
}) {
  const [, tick] = useState(0)

  useEffect(() => {
    if (!until) return
    const id = window.setInterval(() => tick(n => n + 1), 500)
    return () => window.clearInterval(id)
  }, [until])

  if (!until) {
    return (
      <button className="plan-rest" onClick={onStart} disabled={!onStart}>
        <Timer size={14} /> Start {label.toLowerCase()} · {formatRest(seconds)}
      </button>
    )
  }

  const left = Math.max(0, Math.round((until - Date.now()) / 1000))
  return (
    <div className={`plan-rest running${left <= 0 ? ' up' : ''}`}>
      <Timer size={14} />
      {left > 0 ? formatRest(left) : `${label} over`}
      <button
        className="btn-icon"
        onClick={() => onDone?.()}
        aria-label={`Stop the ${label.toLowerCase()} timer`}
      >
        <X size={14} />
      </button>
    </div>
  )
}

function formatRest(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
