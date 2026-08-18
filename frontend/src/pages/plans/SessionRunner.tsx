import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check, ChevronDown, ChevronsDownUp, ChevronsUpDown, Coffee, Dumbbell, Maximize2,
  Minimize2, Plus, SkipForward, Square, Timer,
} from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import ConfirmDialog from '../../components/ConfirmDialog'
import { api } from '../../lib/api'
import {
  blockComplete, blockLabel, blockProgress, chosenExercises, clockLabel, currentBlockId,
  currentExercise, doneSetsFor, durationShort, effectivePicks, elapsedSec, exerciseComplete,
  leadingDone, sectionLabel, sessionTally, setState, setTappable, setsFor, targetLabel, trimNum,
  type BlockProgress, type PlanBlock, type PlanExercise, type PlanSession, type SessionProgress,
  type SetLog, type SetState,
} from '../../data/plans'
import { cacheProgress, clearCachedProgress, readCachedProgress } from './sessionCache'
import { clearSessionNotice, showSessionNotice } from '../../lib/native/sessionNotice'

interface Props {
  session: PlanSession
  onFinished: (s: PlanSession) => void
  onDiscarded: () => void
  onBack: () => void
}

/**
 * The one countdown in flight.
 *
 * A set under way, the rest after it and the break between blocks are three
 * things, but never two at once — so they share a slot. Held separately, the
 * controls that act on "the current timer" (skip, +15s) would each have to ask
 * which of three they meant.
 */
interface Running {
  kind: 'set' | 'rest' | 'break'
  /** Where it belongs, so the right row can draw it. */
  blockId: string
  exerciseId: string
  /** Only for a set timer: which set finishes when this runs out. */
  setIndex?: number
  endsAt: number
}

/** Seconds the nudge button adds. Named because it is also the label. */
const NUDGE_SEC = 15

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
  const [running, setRunning] = useState<Running | null>(null)
  const [full, setFull] = useState(false)

  const blocks = session.snapshot.blocks
  const tally = useMemo(() => sessionTally({ ...session, progress }), [session, progress])
  const pct = tally.total ? Math.round(tally.done / tally.total * 100) : 0
  const allOpen = openIds.size === blocks.length && blocks.length > 0
  const currentId = currentBlockId(session, progress)

  // A clock in the bar has to move. One interval for the page rather than one
  // per timer, so a long day does not accumulate them.
  const [, tick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => tick(n => n + 1), 500)
    return () => window.clearInterval(id)
  }, [])

  /**
   * Fullscreen: the session without the app around it.
   *
   * A class on the body rather than a prop threaded through App, because what
   * has to disappear — the top bar, the sidebar, the tab bar — is rendered
   * outside this component and only CSS can reach all three. Entering pushes a
   * history entry so the back gesture leaves fullscreen rather than the
   * session, which is the trick selection mode uses for the same reason.
   */
  const fullEntry = useRef(false)
  useEffect(() => {
    document.body.classList.toggle('session-full', full)
    return () => document.body.classList.remove('session-full')
  }, [full])

  useEffect(() => {
    const onPop = () => {
      if (!fullEntry.current) return
      fullEntry.current = false
      setFull(false)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  function toggleFull() {
    if (full) {
      const had = fullEntry.current
      fullEntry.current = false
      setFull(false)
      if (had) window.history.back()
      return
    }
    fullEntry.current = true
    window.history.pushState({ sessionFull: true }, '', window.location.href)
    setFull(true)
  }

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

  const writeSets = useCallback((block: PlanBlock, ex: PlanExercise, index: number, change: Partial<SetLog>) => {
    const current = blockProgress(latest.current, block.id)
    const sets = [...setsFor(current, ex.id)]
    while (sets.length <= index) sets.push({ done: false, weightKg: 0 })
    sets[index] = { ...sets[index], ...change }
    const next: BlockProgress = { ...current, sets: { ...current.sets, [ex.id]: sets } }
    update({ blocks: { ...latest.current.blocks, [block.id]: next } })
    return next
  }, [update])

  /** Marks a set done and starts whatever waits after it. */
  const finishSet = useCallback((block: PlanBlock, ex: PlanExercise, index: number) => {
    const after = writeSets(block, ex, index, {
      done: true,
      // Stamped as it happens, so history can show what the session actually
      // looked like rather than only its start and end.
      at: new Date().toISOString(),
    })

    // Finishing a block starts the break before the next one — that is the
    // moment it begins, and waiting for a tap meant the break was usually
    // remembered halfway through it. Otherwise the rest between sets runs.
    const isLast = blocks[blocks.length - 1]?.id === block.id
    if (block.restSec > 0 && !isLast && blockComplete(block, after)) {
      setRunning({ kind: 'break', blockId: block.id, exerciseId: '', endsAt: Date.now() + block.restSec * 1000 })
    } else if (ex.restSec > 0) {
      setRunning({ kind: 'rest', blockId: block.id, exerciseId: ex.id, endsAt: Date.now() + ex.restSec * 1000 })
    } else {
      setRunning(null)
    }
  }, [blocks, writeSets])

  /**
   * Tapping a set.
   *
   * Three states, two taps: waiting → under way → done. A set is something you
   * are in the middle of for a minute or so, and a single tick could only say
   * whether it had happened — which left a plank's timer nothing to start from
   * and the card no way to show what was going on right now.
   *
   * Only the set at the head of the queue responds, plus the last one done so
   * a mis-tap can be taken back. Progress stays a run from the start, which is
   * what every timing derived from it assumes.
   */
  function tapSet(block: PlanBlock, ex: PlanExercise, index: number) {
    const sets = setsFor(blockProgress(progress, block.id), ex.id)
    if (!setTappable(sets, index)) return

    switch (setState(sets, index)) {
      case 'done':
        // Undone all the way back to waiting, not to under way: the clock that
        // was running has long gone.
        writeSets(block, ex, index, { done: false, at: undefined, startedAt: undefined })
        if (running?.exerciseId === ex.id) setRunning(null)
        return
      case 'idle':
        writeSets(block, ex, index, { startedAt: new Date().toISOString() })
        // A timed set counts itself down; a loaded one takes however long it
        // takes, and is finished by the second tap.
        if (ex.kind === 'time' && ex.durationSec > 0) {
          setRunning({
            kind: 'set', blockId: block.id, exerciseId: ex.id, setIndex: index,
            endsAt: Date.now() + ex.durationSec * 1000,
          })
        } else {
          setRunning(null)
        }
        return
      default:
        finishSet(block, ex, index)
    }
  }

  /**
   * A timed set whose clock has run out finishes itself.
   *
   * In an effect keyed on the tick rather than a setTimeout, so that a session
   * reopened past the end of a set does not sit waiting for a timer that
   * expired while the app was closed.
   */
  useEffect(() => {
    if (running?.kind !== 'set' || running.setIndex === undefined) return
    if (Date.now() < running.endsAt) return
    const block = blocks.find(b => b.id === running.blockId)
    const ex = block?.options.find(o => o.id === running.exerciseId)
    if (block && ex) finishSet(block, ex, running.setIndex)
  })

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

  // --- the current timer's controls --------------------------------------

  function nudge() {
    setRunning(r => (r ? { ...r, endsAt: r.endsAt + NUDGE_SEC * 1000 } : r))
  }

  /** Skip means "this is over now" — which, for a set under way, is done. */
  function skip() {
    if (running?.kind === 'set' && running.setIndex !== undefined) {
      const block = blocks.find(b => b.id === running.blockId)
      const ex = block?.options.find(o => o.id === running.exerciseId)
      if (block && ex) { finishSet(block, ex, running.setIndex); return }
    }
    setRunning(null)
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

  const left = running ? Math.max(0, Math.round((running.endsAt - Date.now()) / 1000)) : 0
  const resting = running?.kind === 'rest' || running?.kind === 'break'

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
        compactActions
        actions={
          <div className="plan-run-actions">
            <button
              className="btn-icon"
              onClick={toggleFull}
              title={full ? 'Leave fullscreen' : 'Fullscreen'}
              aria-label={full ? 'Leave fullscreen' : 'Fullscreen'}
              aria-pressed={full}
            >
              {full ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
            </button>
            <button className="btn btn-ghost desktop-only" onClick={() => setConfirmDiscard(true)}>
              <Square size={14} /> Stop
            </button>
            <button className="btn btn-primary desktop-only" onClick={() => setConfirmFinish(true)}>
              <Check size={15} /> Finish
            </button>
          </div>
        }
      />

      <div className="page-content plan-run-page">
        {error && <div className="status-msg err" role="alert">{error}</div>}

        <div className="plan-rows">
          {blocks.map((block, i) => (
            <Fragment key={block.id}>
              <BlockRow
                block={block}
                index={i}
                progress={blockProgress(progress, block.id)}
                open={openIds.has(block.id)}
                current={block.id === currentId}
                running={running}
                left={left}
                onOpen={() => toggleOpen(block.id)}
                onTapSet={(ex, n) => tapSet(block, ex, n)}
                onSetChange={(ex, n, change) => writeSets(block, ex, n, change)}
                onPick={n => togglePick(block, n)}
                onStartRest={ex => setRunning({
                  kind: 'rest', blockId: block.id, exerciseId: ex.id,
                  endsAt: Date.now() + ex.restSec * 1000,
                })}
              />
              {/* The planned break before the next exercise, which starts
                  itself the moment the block above is finished. A sibling of
                  the cards rather than a child of one: nested, the gap above
                  it and the gap below it were different numbers. */}
              {block.restSec > 0 && i < blocks.length - 1 && (
                <BreakLine
                  seconds={block.restSec}
                  active={running?.kind === 'break' && running.blockId === block.id}
                  left={left}
                  onStart={() => setRunning({
                    kind: 'break', blockId: block.id, exerciseId: '',
                    endsAt: Date.now() + block.restSec * 1000,
                  })}
                />
              )}
            </Fragment>
          ))}
        </div>
      </div>

      {/*
        The session's own bar, pinned above the navigation, in the shape a
        phone already uses for something running in the background: a music
        player. Where a summary card at the top of the page told you how far in
        you were only while you happened to be looking at the top of the page,
        this stays put — which is what the figures on it are for.
      */}
      <div className="plan-player" role="group" aria-label="Session controls">
        {/* The timer's own row, above the transport. Only while something is
            counting: a Skip button with nothing to skip spends most of its
            life explaining that it does nothing. */}
        {running && (
          <div className="plan-timer-bar">
            <span className={`plan-timer-now${left <= 0 ? ' up' : ''}`}>
              {resting ? <Coffee size={14} aria-hidden /> : <Timer size={14} aria-hidden />}
              <span className="plan-num">{left > 0 ? clockLabel(left) : 'over'}</span>
              <span className="plan-timer-what">{timerNoun(running)}</span>
            </span>
            <button className="btn btn-ghost" onClick={nudge}>
              <Plus size={14} /> {NUDGE_SEC}s
            </button>
            <button className="btn btn-ghost" onClick={skip}>
              <SkipForward size={14} /> Skip
            </button>
          </div>
        )}

        <div className="plan-player-bar" aria-hidden>
          <span className="plan-player-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="plan-player-row">
          {/* What is happening, at a glance: a cup while you are waiting, a
              dumbbell while you are working. */}
          <span className={`plan-player-state${resting ? ' resting' : ''}`} title={resting ? 'Resting' : 'Working'}>
            {resting ? <Coffee size={18} /> : <Dumbbell size={18} />}
          </span>
          <div className="plan-player-figures">
            <span className="plan-player-pct plan-num">{pct}%</span>
            <span className="plan-player-meta plan-num">
              {tally.done}/{tally.total} sets · {clockLabel(elapsedSec(session.startedAt))}
            </span>
          </div>
          <button
            className="btn-icon"
            onClick={() => setOpenIds(allOpen ? new Set() : new Set(blocks.map(b => b.id)))}
            title={allOpen ? 'Collapse every exercise' : 'Expand every exercise'}
            aria-label={allOpen ? 'Collapse every exercise' : 'Expand every exercise'}
          >
            {allOpen ? <ChevronsDownUp size={18} /> : <ChevronsUpDown size={18} />}
          </button>
          <button
            className="btn-icon plan-player-stop"
            onClick={() => setConfirmDiscard(true)}
            title="Stop and discard"
            aria-label="Stop and discard this session"
          >
            {/* Filled: an outlined square beside a tick reads as an empty
                checkbox rather than as stop. */}
            <Square size={15} fill="currentColor" />
          </button>
          <button className="btn btn-primary plan-player-finish" onClick={() => setConfirmFinish(true)}>
            <Check size={16} /> Finish
          </button>
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

function timerNoun(r: Running): string {
  if (r.kind === 'break') return 'break'
  return r.kind === 'rest' ? 'rest' : 'set'
}

/** The gap between two blocks, drawn on the rule that separates them. */
function BreakLine({ seconds, active, left, onStart }: {
  seconds: number
  active: boolean
  left: number
  onStart: () => void
}) {
  return (
    <div className="plan-break-line">
      {active ? (
        <span className={`plan-rest running${left <= 0 ? ' up' : ''}`}>
          <Coffee size={14} />
          <span className="plan-num">{left > 0 ? clockLabel(left) : 'Break over'}</span>
        </span>
      ) : (
        <button className="plan-rest" onClick={onStart}>
          <Coffee size={14} /> Start break · {durationShort(seconds)}
        </button>
      )}
    </div>
  )
}

interface RowProps {
  block: PlanBlock
  index: number
  progress: BlockProgress
  open: boolean
  /** The block being worked on: the first one not finished. */
  current: boolean
  running: Running | null
  left: number
  onOpen: () => void
  onTapSet: (ex: PlanExercise, index: number) => void
  onSetChange: (ex: PlanExercise, index: number, change: Partial<SetLog>) => void
  onPick: (index: number) => void
  onStartRest: (ex: PlanExercise) => void
}

/**
 * One block in the runner.
 *
 * A choose-one block draws the exercise it is set to; a superset draws each of
 * its exercises in turn, because they are all being done and each needs its
 * own sets. Each exercise names itself once, then shows its squares on the row
 * below with the timer at the far end — the name used to sit to the *left* of
 * the squares, which left a superset's rows starting in different places and
 * the timer nowhere to go but the next line.
 */
function BlockRow({ block, index, progress, open, current, running, left, onOpen, onTapSet, onSetChange, onPick, onStartRest }: RowProps) {
  const chosen = chosenExercises(block, progress)
  if (chosen.length === 0) return null
  const complete = chosen.every(ex => exerciseComplete(ex, setsFor(progress, ex.id)))
  const picked = new Set(effectivePicks(block, progress))
  const label = block.section ? sectionLabel(block.section) : blockLabel(block)
  const grouped = block.options.length > 1

  return (
    <div className={[
      'plan-ex',
      complete ? 'done' : '',
      open ? 'open' : '',
      current && !complete ? 'current' : '',
      block.section ? 'plan-ex-section' : grouped ? 'plan-ex-grouped' : '',
    ].filter(Boolean).join(' ')}>
      {/* The top row carries what the block is and the control that opens it.
          Making the whole title a toggle read as a link to somewhere, and left
          nothing on the row to say it could be opened at all. */}
      <div className="plan-ex-head">
        <span className="plan-ex-index">{index + 1}</span>
        {label
          ? <span className="field-label plan-read-kind">{label}</span>
          : <span className="plan-ex-title">{chosen[0].name}</span>}
        <button
          className="btn-icon plan-ex-toggle"
          onClick={onOpen}
          aria-expanded={open}
          aria-label={`${chosen.map(e => e.name).join(', ')}, ${open ? 'collapse' : 'expand'}`}
        >
          <ChevronDown size={16} className="plan-ex-caret" />
        </button>
      </div>

      {!open && chosen.map(ex => {
        const sets = setsFor(progress, ex.id)
        const next = leadingDone(sets)
        const timer = running && running.exerciseId === ex.id ? running : null
        return (
          <div className="plan-ex-line" key={ex.id}>
            <div className="plan-read-row">
              {(label || chosen.length > 1) && <span className="plan-read-name">{ex.name}</span>}
              <span className="plan-read-target plan-num">{targetLabel(ex)}</span>
            </div>
            <div className="plan-sets">
              {Array.from({ length: ex.sets }, (_, n) => (
                <SetSquare
                  key={n}
                  n={n}
                  state={setState(sets, n)}
                  tappable={setTappable(sets, n)}
                  name={ex.name}
                  hint={`Do set ${next + 1} first`}
                  onTap={() => onTapSet(ex, n)}
                />
              ))}
              {/* The timer at the far end of the row: it appears mid-set, and
                  at the near end it would shove the squares sideways under a
                  thumb already on its way to one. */}
              {timer && (
                <span className={`plan-rest running right${left <= 0 ? ' up' : ''}`}>
                  {timer.kind === 'set' ? <Timer size={13} /> : <Coffee size={13} />}
                  <span className="plan-num">{left > 0 ? clockLabel(left) : 'go'}</span>
                </span>
              )}
            </div>
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
              heading={chosen.length > 1 || !!label ? ex.name : undefined}
              running={running && running.exerciseId === ex.id ? running : null}
              left={left}
              onStartRest={() => onStartRest(ex)}
              onTap={n => onTapSet(ex, n)}
              onChange={(n, change) => onSetChange(ex, n, change)}
            />
          ))}
        </div>
      )}

      {grouped && (
        <div className="plan-alt">
          {/* No phrase here: it is on the block's top row now, and printed
              twice in one card it read as two different instructions. */}
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

/**
 * One set square, in one of its three states.
 *
 * The dashed border on a set under way travels, because it is the only thing
 * on a page of static squares that is happening now — and it has to read from
 * a metre away with a barbell in the way.
 */
function SetSquare({ n, state, tappable, name, hint, onTap }: {
  n: number
  state: SetState
  tappable: boolean
  name: string
  hint: string
  onTap: () => void
}) {
  return (
    <button
      className={`plan-set ${state}`}
      aria-pressed={state === 'done'}
      aria-label={`Set ${n + 1} of ${name}${state === 'running' ? ', under way' : ''}`}
      disabled={!tappable}
      title={tappable ? undefined : hint}
      onClick={onTap}
    >
      {state === 'done' ? <Check size={16} /> : n + 1}
    </button>
  )
}

/** The expanded view of one exercise: big targets, per-set rows, rest. */
function ExerciseDetail({ ex, sets, heading, running, left, onStartRest, onTap, onChange }: {
  ex: PlanExercise
  sets: SetLog[]
  heading?: string
  running: Running | null
  left: number
  onStartRest: () => void
  onTap: (index: number) => void
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
        {!timed && (
          <div className="stat-chip">
            <span className="label">{ex.kind === 'body' ? 'Added' : 'Target'}</span>
            <span className="value">
              {ex.weightKg <= 0
                ? (ex.kind === 'body' ? 'body' : '—')
                : <>{trimNum(ex.weightKg)}<span className="unit"> kg</span></>}
            </span>
          </div>
        )}
      </div>

      <div className="plan-setrows">
        {Array.from({ length: ex.sets }, (_, n) => {
          const log = sets[n]
          const tappable = setTappable(sets, n)
          const state = setState(sets, n)
          return (
            <div key={n} className={`plan-setrow ${state}${tappable ? '' : ' locked'}`}>
              <button
                className="plan-setrow-tick"
                aria-pressed={state === 'done'}
                aria-label={`Set ${n + 1}`}
                disabled={!tappable}
                onClick={() => onTap(n)}
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

      {running ? (
        <span className={`plan-rest running right${left <= 0 ? ' up' : ''}`}>
          {running.kind === 'set' ? <Timer size={14} /> : <Coffee size={14} />}
          <span className="plan-num">{left > 0 ? clockLabel(left) : 'go'}</span>
        </span>
      ) : ex.restSec > 0 ? (
        <button className="plan-rest right" onClick={onStartRest}>
          <Coffee size={14} /> Start rest · {durationShort(ex.restSec)}
        </button>
      ) : null}
      {ex.note && <p className="plan-ex-note">{ex.note}</p>}
    </div>
  )
}
