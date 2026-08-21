import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check, ChevronDown, ChevronsDownUp, ChevronsUpDown, Coffee, Maximize2,
  Minimize2, Minus, Plus, Square, Timer, Trash2,
} from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import ConfirmDialog from '../../components/ConfirmDialog'
import Modal from '../../components/Modal'
import { api } from '../../lib/api'
import { LOCATION_EVENT } from '../../App'
import {
  blockComplete, blockLabel, blockProgress, chosenExercises, clockLabel, currentBlockId,
  currentExercise, doneSetsFor, durationShort, effectivePicks, elapsedSec, exerciseComplete, nextExercise,
  isBareSection, leadingDone, sectionExercise, sectionLabel, sessionTally, setState, setTappable, setsFor,
  targetLabel, trimNum,
  type BlockProgress, type PlanBlock, type PlanExercise, type PlanSession, type SessionProgress,
  type SetLog, type SetState,
} from '../../data/plans'
import { cacheProgress, clearCachedProgress, readCachedProgress } from './sessionCache'
import {
  claimSessionNotice, clearSessionNotice, repostSessionNotice, showSessionNotice,
} from '../../lib/native/sessionNotice'
import { longTimerSec, primeSound, signal } from '../../lib/sessionFeedback'

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
  /** 'gap' is the wait between two exercises of the same block — a superset's
   *  own breather, distinct from 'break' (after the whole block) and 'rest'
   *  (between sets of one exercise). */
  kind: 'set' | 'rest' | 'break' | 'gap'
  /** Where it belongs, so the right row can draw it. */
  blockId: string
  exerciseId: string
  /** Only for a set timer: which set finishes when this runs out. */
  setIndex?: number
  endsAt: number
  /** The duration it started with, so the bar can show how much is left of it
   *  even after a nudge has moved the end. */
  totalSec: number
}

/** Seconds the small nudge buttons move a timer by; the big ones move 30. */
const NUDGE_SEC = 10
const NUDGE_BIG_SEC = 30

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
  // The one red button asks which kind of ending you meant.
  const [ending, setEnding] = useState(false)

  const blocks = session.snapshot.blocks
  const tally = useMemo(() => sessionTally({ ...session, progress }), [session, progress])
  const pct = tally.total ? Math.round(tally.done / tally.total * 100) : 0
  const allOpen = openIds.size === blocks.length && blocks.length > 0
  const nextId = currentBlockId(session, progress)
  // The block just finished stays highlighted *while* its break runs —
  // otherwise the moment the last set is ticked the highlight jumped ahead and
  // the break you are standing in went dark. Once the break is over the
  // highlight moves on by itself, which is the whole point of the break
  // ending: the next thing is now the thing you are doing.
  const breakRunning = running?.kind === 'break' && running.endsAt > Date.now()
  const currentId = breakRunning ? running!.blockId : nextId

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

  const left = running ? Math.max(0, Math.round((running.endsAt - Date.now()) / 1000)) : 0
  const resting = running?.kind === 'rest' || running?.kind === 'break' || running?.kind === 'gap'
  const timerPct = running ? Math.max(0, Math.min(100, Math.round(left / running.totalSec * 100))) : 0

  // The phone's ongoing notification, so a session is visible with the app
  // closed. Re-posted as progress moves: the shade should say how far in you
  // are and what you are on, not just that something is running. A no-op
  // anywhere but the Android app.
  const heading = currentExercise(session, progress)
  const upNext = nextExercise(session, progress)
  // Glyphs rather than a bare percentage: the shade shows two lines at a
  // glance, and "🏋 Lat pulldown · 6/15" is read without being parsed, where
  // "40% · Lat pulldown" repeated what the progress bar underneath already
  // said. The percentage stays, as the bar.
  const notice = resting
    ? `☕ Resting · ${tally.done}/${tally.total} sets`
    : heading
      ? `🏋 ${heading} · ${tally.done}/${tally.total} sets`
      : `✅ ${tally.done}/${tally.total} sets done`
  /*
   * The expanded view, which has room for the lines the collapsed one cannot
   * hold: what you are on, what comes after it, and where the day stands.
   * Pulled open is also where somebody looks when they have forgotten what
   * they were in the middle of, which is exactly what this answers.
   */
  const noticeDetail = [
    resting ? '☕ Resting' : heading ? `🏋 ${heading}` : '✅ Every set done',
    upNext && `⏭ Next: ${upNext}`,
    `📋 ${tally.done} of ${tally.total} sets · ${pct}%`,
  ].filter(Boolean).join('\n')
  // Only while one is actually counting: Android draws the countdown itself
  // from this, and a stale timestamp would leave a clock ticking down in the
  // shade for a rest that ended.
  const restEndsAt = resting && running && running.endsAt > Date.now() ? running.endsAt : 0
  useEffect(() => {
    void showSessionNotice({
      sessionId: session.id,
      title: session.dayName,
      body: notice,
      subText: session.planName,
      startedAt: session.startedAt,
      percent: pct,
      bigText: noticeDetail,
      restEndsAt,
    })
  }, [session.id, session.dayName, session.planName, session.startedAt, notice, noticeDetail, pct, restEndsAt])

  /*
   * Put back whenever the app returns to the foreground.
   *
   * An ongoing notification can still be swiped away on Android 14, and once
   * it is gone nothing tells us so — there is no event, and no way to ask. The
   * moment the app is opened is the moment we can be sure again, and re-posting
   * an identical notification that is already showing costs nothing.
   */
  // While this page is on screen, the shade says what this page says.
  useEffect(() => claimSessionNotice(), [])

  /*
   * "Finish" or "Discard", tapped on the notification.
   *
   * Those actions cannot end a session themselves: doing it means sending the
   * sets to the server, and the credentials for that live in the WebView. So
   * they open the app on this page carrying what was asked for, and this is
   * where it is carried out.
   *
   * Both ask, through the same dialogs the buttons on this page use. Finish
   * destroys nothing, so acting on it outright was defensible — but it made
   * the two actions behave differently for no reason a reader could see, and
   * the dialog is worth having anyway: it says how many sets are ticked, which
   * is the one thing you cannot check from a notification shade.
   *
   * The instruction is stripped from the URL as it is taken, so a reload does
   * not end the session a second time. Bound to the location event too,
   * because the app may already be open on this very page when the tap lands.
   */
  useEffect(() => {
    const take = () => {
      const url = new URL(window.location.href)
      const what = url.searchParams.get('do')
      if (what !== 'finish' && what !== 'discard') return
      url.searchParams.delete('do')
      window.history.replaceState(window.history.state, '', url.pathname + url.search)
      if (what === 'finish') setConfirmFinish(true)
      else setConfirmDiscard(true)
    }
    take()
    window.addEventListener(LOCATION_EVENT, take)
    return () => window.removeEventListener(LOCATION_EVENT, take)
  }, [session.id])
  useEffect(() => {
    const onShow = () => { if (document.visibilityState === 'visible') void repostSessionNotice() }
    document.addEventListener('visibilitychange', onShow)
    window.addEventListener('focus', onShow)
    return () => {
      document.removeEventListener('visibilitychange', onShow)
      window.removeEventListener('focus', onShow)
    }
  }, [])

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
    // remembered halfway through it. Short of that: an exercise finishing
    // inside a block that still has others left (a superset) starts its own
    // breakSec gap before the next one; short of that, the rest between sets
    // of this same exercise runs.
    const isLast = blocks[blocks.length - 1]?.id === block.id
    const blockDone = blockComplete(block, after)
    const exDone = exerciseComplete(ex, setsFor(after, ex.id))

    /* Felt rather than seen: during a set the phone is on the floor and your
       hands are busy, so "did that register?" is the one question the screen
       cannot answer. Three weights for three sizes of event — a set, the
       exercise it belonged to, and the session as a whole. */
    const whole = sessionTally({ ...session, progress: latest.current })
    if (whole.done >= whole.total) signal('complete')
    else if (exDone) signal('exercise')
    else signal('set')
    if (block.restSec > 0 && !isLast && blockDone) {
      setRunning({ kind: 'break', blockId: block.id, exerciseId: '', endsAt: Date.now() + block.restSec * 1000, totalSec: block.restSec })
    } else if (exDone && ex.breakSec > 0 && !blockDone) {
      setRunning({ kind: 'gap', blockId: block.id, exerciseId: ex.id, endsAt: Date.now() + ex.breakSec * 1000, totalSec: ex.breakSec })
    } else if (!exDone && ex.restSec > 0) {
      setRunning({ kind: 'rest', blockId: block.id, exerciseId: ex.id, endsAt: Date.now() + ex.restSec * 1000, totalSec: ex.restSec })
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
            endsAt: Date.now() + ex.durationSec * 1000, totalSec: ex.durationSec,
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
   * A rest running out, announced exactly once.
   *
   * Both ways at once — see sessionFeedback: a buzz reaches you through a
   * pocket and a sound reaches you across a room, and which arrives depends on
   * where the phone ended up rather than on anything the app can know.
   *
   * Edge-triggered on the timer's identity rather than on `left` reaching
   * zero: the tick keeps firing while the clock sits at 0:00 waiting to be
   * dismissed, so a plain `left <= 0` would fire twice a second until it was.
   * The ref holds which timer has already been announced.
   *
   * Only rests, and only ones past the threshold — a set's own clock ends with
   * you standing over it, and see longTimerSec for why a short rest is not
   * worth interrupting a room for.
   */
  const buzzed = useRef<string | null>(null)
  useEffect(() => {
    if (!running || running.kind === 'set') return
    if (running.totalSec < longTimerSec()) return
    const id = `${running.blockId}:${running.exerciseId}:${running.endsAt}`
    if (buzzed.current === id) return
    if (Date.now() < running.endsAt) return
    buzzed.current = id
    signal('timer')
  })

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
    const ex = block && exerciseIn(block, running.exerciseId)
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

  function nudge(by: number) {
    // Never below now: taking ten seconds off a five-second timer means it is
    // over, not that it owes you five. The total moves with it, so the bar
    // still reads as "how much of this timer is left" after a nudge.
    setRunning(r => (r
      ? { ...r, endsAt: Math.max(Date.now(), r.endsAt + by * 1000), totalSec: Math.max(1, r.totalSec + by) }
      : r))
  }

  // --- finishing ---------------------------------------------------------

  async function finish() {
    /*
     * Announced on the press, not on the answer.
     *
     * Twice now the buzz that ends a session has failed to arrive while the
     * one that starts it works, and the two are the same call — the only thing
     * that differs is what surrounds it: a network round trip, a notification
     * being taken down, and a navigation, all in the same breath. Rather than
     * keep guessing which of those swallows it, this happens first, in the tap
     * that asked for it, with nothing else in flight. It costs a buzz for an
     * ending that then fails to save, and the error says so when it does.
     */
    signal('finish')
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
    // On the press, for the same reason as finish above.
    signal('discard')
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
        compactActions
        actions={
          <div className="plan-run-actions">
            <button
              className="btn-icon"
              onClick={() => setOpenIds(allOpen ? new Set() : new Set(blocks.map(b => b.id)))}
              title={allOpen ? 'Collapse every exercise' : 'Expand every exercise'}
              aria-label={allOpen ? 'Collapse every exercise' : 'Expand every exercise'}
            >
              {allOpen ? <ChevronsDownUp size={18} /> : <ChevronsUpDown size={18} />}
            </button>
          </div>
        }
      />

      {/* Any tap in a running session opens the audio device, because a
          browser will only let one open in response to one — and a rest timer
          ends minutes later with nobody touching anything. See primeChime. */}
      <div
        className={`page-content plan-run-page${running ? ' has-timer' : ''}`}
        onPointerDown={primeSound}
      >
        {error && <div className="status-msg err" role="alert">{error}</div>}

        <div className="plan-rows">
          {blocks.map((block, i) => (
            <Fragment key={block.id}>
              <BlockRow
                block={block}
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
                  endsAt: Date.now() + ex.restSec * 1000, totalSec: ex.restSec,
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
                    endsAt: Date.now() + block.restSec * 1000, totalSec: block.restSec,
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
            counting. It carries its own progress bar — how much of *this*
            timer is left is a different question from how much of the
            session is done, and the player's bar below already answers that
            one. */}
        {running && (
          <>
            <div className="plan-timer-progress" aria-hidden>
              <span style={{ width: `${timerPct}%` }} />
            </div>
            <div className="plan-timer-bar">
              {/* Two either side of the clock, big: this is tapped mid-set
                  with one hand, without looking properly. */}
              <div className="plan-nudge-group">
                <button className="plan-nudge" onClick={() => nudge(-NUDGE_BIG_SEC)} aria-label={`Take ${NUDGE_BIG_SEC} seconds off`}>
                  <Minus size={13} /> {NUDGE_BIG_SEC}s
                </button>
                <button className="plan-nudge" onClick={() => nudge(-NUDGE_SEC)} aria-label={`Take ${NUDGE_SEC} seconds off`}>
                  <Minus size={13} /> {NUDGE_SEC}s
                </button>
              </div>
              {/* What is counting, named above the figure rather than beside
                  it: "1:30" alone does not say whether it is the break between
                  blocks or the rest between sets, and those are two different
                  things to be waiting for. */}
              <span className={`plan-timer-now${left <= 0 ? ' up' : ''}`}>
                <span className="plan-timer-what">
                  {resting ? <Coffee size={12} aria-hidden /> : <Timer size={12} aria-hidden />}
                  {timerNoun(running)}
                </span>
                <span className="plan-timer-digits plan-num">{left > 0 ? clockLabel(left) : 'over'}</span>
              </span>
              <div className="plan-nudge-group">
                <button className="plan-nudge" onClick={() => nudge(NUDGE_SEC)} aria-label={`Add ${NUDGE_SEC} seconds`}>
                  <Plus size={13} /> {NUDGE_SEC}s
                </button>
                <button className="plan-nudge" onClick={() => nudge(NUDGE_BIG_SEC)} aria-label={`Add ${NUDGE_BIG_SEC} seconds`}>
                  <Plus size={13} /> {NUDGE_BIG_SEC}s
                </button>
              </div>
            </div>
          </>
        )}

        <div className="plan-player-bar" aria-hidden>
          <span className="plan-player-fill" style={{ width: `${pct}%` }} />
        </div>
        {/* Three groups: how far in, how long you have been here, and the two
            controls. Each is a column of a big figure over its own small one,
            so the row reads as two clocks rather than as four numbers spread
            across a bar with a hole in the middle of it. */}
        <div className="plan-player-row">
          <div className="plan-player-figures">
            <span className="plan-player-pct plan-num">{pct}<span className="unit">%</span></span>
            <span className="plan-player-meta plan-num">{tally.done}/{tally.total} sets</span>
          </div>
          <div className="plan-player-clocks">
            {/* The session's own clock is the headline. It used to be the
                smallest thing on the row while the wall clock was the biggest,
                so the bar answered "what time is it" in the size that should
                have answered "how long have I been here". */}
            <span className="plan-player-elapsed plan-num" title="Time since the session started">
              {clockLabel(elapsedSec(session.startedAt))}
            </span>
            {/* Still worth having: the question in a gym is as often "how late
                is it" as "how long have I been here". */}
            <span className="plan-player-time plan-num">{timeOfDay()}</span>
          </div>
          <div className="plan-player-actions">
          <button
            className="btn-icon"
            onClick={toggleFull}
            title={full ? 'Leave fullscreen' : 'Fullscreen'}
            aria-label={full ? 'Leave fullscreen' : 'Fullscreen'}
            aria-pressed={full}
          >
            {full ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          {/* One button, not two, and just the icon: Finish and Stop side by
              side used to be the same size and a tap apart, and one of them
              throws the session away — so the choice is made in a dialog
              where it can be read, and the entry point stays out of the way. */}
          <button
            className="btn-icon plan-player-end"
            onClick={() => setEnding(true)}
            title="End session"
            aria-label="End session"
          >
            <Square size={19} fill="currentColor" />
          </button>
          </div>
        </div>
      </div>

      {ending && (
        <EndSessionDialog
          done={tally.done}
          total={tally.total}
          busy={busy}
          onFinish={() => { setEnding(false); setConfirmFinish(true) }}
          onDiscard={() => { setEnding(false); setConfirmDiscard(true) }}
          onCancel={() => setEnding(false)}
        />
      )}
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

/**
 * What "end" meant.
 *
 * Finishing and discarding are opposite outcomes that used to sit side by side
 * as two same-sized buttons on the player, a thumb-width apart, with only the
 * words between them and the loss of a whole session. Asking is cheap; getting
 * it wrong is not.
 */
function EndSessionDialog({ done, total, busy, onFinish, onDiscard, onCancel }: {
  done: number
  total: number
  busy: boolean
  onFinish: () => void
  onDiscard: () => void
  onCancel: () => void
}) {
  return (
    <Modal onClose={onCancel} label="End this session">
      <div className="modal-box plan-end-box">
        <h3 className="plan-end-title">End this session?</h3>
        <p className="plan-end-sub plan-num">{done} of {total} sets done</p>
        <button className="btn btn-primary plan-end-choice" disabled={busy} onClick={onFinish}>
          <Check size={16} /> Finish and keep it
        </button>
        <button className="btn btn-danger plan-end-choice" disabled={busy} onClick={onDiscard}>
          <Trash2 size={16} /> Discard the session
        </button>
        <button className="btn btn-ghost plan-end-choice" onClick={onCancel}>Keep going</button>
      </div>
    </Modal>
  )
}

/** An exercise by id, including the one a bare section stands in for. */
function exerciseIn(block: PlanBlock, id: string): PlanExercise | undefined {
  if (isBareSection(block)) return block.id === id ? sectionExercise(block) : undefined
  return block.options.find(o => o.id === id)
}

/** The wall clock, to the minute — the runner re-renders twice a second. */
function timeOfDay(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function timerNoun(r: Running): string {
  if (r.kind === 'break') return 'break'
  if (r.kind === 'gap') return 'next up'
  return r.kind === 'rest' ? 'rest' : 'set'
}

/** The gap between two blocks, drawn on the rule that separates them. */
function BreakLine({ seconds, active, left, onStart }: {
  seconds: number
  active: boolean
  left: number
  onStart: () => void
}) {
  // The line itself carries the state, not just the chip on it: a break is a
  // step of the session like a block is, and while one is running it is the
  // only thing happening.
  return (
    <div className={`plan-break-line${active ? (left <= 0 ? ' over' : ' active') : ''}`}>
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
function BlockRow({ block, progress, open, current, running, left, onOpen, onTapSet, onSetChange, onPick, onStartRest }: RowProps) {
  const chosen = chosenExercises(block, progress)
  if (chosen.length === 0) return null
  const complete = chosen.every(ex => exerciseComplete(ex, setsFor(progress, ex.id)))
  const picked = new Set(effectivePicks(block, progress))
  const label = block.section ? sectionLabel(block.section) : blockLabel(block)
  // A bare section is one timed thing wearing an exercise's clothes: it has no
  // options to choose between and no second name to print.
  const bare = isBareSection(block)
  const grouped = !bare && block.options.length > 1

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
        {/* No number. A day is read top to bottom and the cards are already in
            order, so a column of ordinals was ink spent restating that. */}
        {label
          ? <span className="field-label plan-read-kind">{label}</span>
          : <span className="plan-ex-title">{chosen[0].name}</span>}
        {current && !complete && <span className="plan-now">Now</span>}
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
            {!bare && (
              <div className="plan-read-row">
                {(label || chosen.length > 1) && <span className="plan-read-name">{ex.name}</span>}
                <span className="plan-read-target plan-num">{targetLabel(ex)}</span>
              </div>
            )}
            {bare && (
              <div className="plan-read-row">
                <span className="plan-read-name">{durationShort(ex.durationSec)}</span>
              </div>
            )}
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
              heading={!bare && (chosen.length > 1 || !!label) ? ex.name : undefined}
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
