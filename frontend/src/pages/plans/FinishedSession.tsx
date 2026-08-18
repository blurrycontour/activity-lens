import { useMemo, useState } from 'react'
import PageHeader from '../../components/PageHeader'
import Confetti from '../../components/Confetti'
import { Check, Timer } from 'lucide-react'
import {
  blockLabel, blockProgress, chosenExercises, clockLabel, doneSetsFor, durationShort,
  elapsedSec, sessionWhen, setsFor, trimNum,
  type PlanExercise, type PlanSession, type SetLog,
} from '../../data/plans'

/** One set as it was recorded, with the moment before it to measure against. */
interface DoneSet {
  n: number
  log?: SetLog
  /** When the previous set ended — the one before it in this exercise, or the
   *  last set of whatever came before. Set 1 had no gap at all before this. */
  prevAt?: string
}

interface DoneExercise {
  ex: PlanExercise
  done: number
  sets: DoneSet[]
}

interface DoneBlock {
  id: string
  label: string
  exercises: DoneExercise[]
  /** Options that were there but not taken. */
  skipped: string[]
  /** Seconds actually spent between this block's last set and the next's first. */
  breakSec?: number
  /** What the plan asked for, when it asked for anything. */
  plannedBreakSec: number
}

/**
 * A session read back from history: what was actually done, set by set.
 *
 * The point of keeping history at all is that it records the session rather
 * than the plan — which alternative was picked, what was really lifted, and
 * when each set happened. A row that only said "12 of 14 sets" would be a
 * summary of something nobody can look at.
 */
export default function FinishedSession({ session, onBack }: {
  session: PlanSession
  onBack: () => void
}) {
  const blocks = useMemo(() => readBack(session), [session])
  // Read once, on mount: claiming it during render would fire twice under
  // StrictMode and the second render would decide it had already been shown.
  const [celebrate, setCelebrate] = useState(() => claimCelebration(session))

  return (
    <>
      {celebrate && <Confetti onDone={() => setCelebrate(false)} />}
      <PageHeader
        title={session.dayName}
        subtitle={`${session.planName} · ${sessionWhen(session.startedAt)}`}
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
              <span className="value plan-num">{clockLabel(elapsedSec(session.startedAt, session.finishedAt))}</span>
            </div>
            <div className="stat-chip">
              <span className="label">Started</span>
              <span className="value plan-when">{startTime(session.startedAt)}</span>
            </div>
            {session.finishedAt && (
              <div className="stat-chip">
                <span className="label">Finished</span>
                <span className="value plan-when">{startTime(session.finishedAt)}</span>
              </div>
            )}
          </div>
        </div>

        <p className="field-label plan-snapshot-note">The plan as it was that day</p>

        <div className="plan-rows">
          {blocks.map(block => (
            <div key={block.id}>
              <div className={`plan-ex plan-ex-read${block.label ? ' plan-ex-grouped' : ''}`}>
                {block.label && <span className="field-label plan-read-kind">{block.label}</span>}
                {block.exercises.map(({ ex, done, sets }) => (
                  <div key={ex.id} className="plan-done-ex">
                    <div className="plan-ex-top">
                      <span className="plan-ex-title">{ex.name}</span>
                      <span className={`plan-ex-target plan-num${done >= ex.sets ? ' all-done' : ''}`}>
                        {done} / {ex.sets} sets
                      </span>
                    </div>
                    <div className="plan-done-sets">
                      {sets.map(s => <SetChip key={s.n} ex={ex} {...s} />)}
                    </div>
                  </div>
                ))}
                {/* What was not chosen is worth seeing too: it says the day
                    had an alternative and which way it went. */}
                {block.skipped.length > 0 && (
                  <span className="plan-read-rest">Instead of {block.skipped.join(', ')}</span>
                )}
              </div>

              {/* The break actually taken, measured between the last set here
                  and the first of the next block — the plan's number beside it
                  when the two disagree, which they usually do. */}
              {(block.breakSec !== undefined || block.plannedBreakSec > 0) && (
                <div className="plan-break-line">
                  <span className="plan-break-chip">
                    <Timer size={12} aria-hidden />
                    {block.breakSec !== undefined
                      ? `${durationShort(block.breakSec)} break`
                      : `${durationShort(block.plannedBreakSec)} break planned`}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>

        {session.notes && <p className="plan-session-notes">{session.notes}</p>}
      </div>
    </>
  )
}

const CELEBRATED_KEY = 'al_plan_celebrated'
/** How many session ids to remember. Enough that revisiting last month's
 *  clean sweep does not throw confetti at you again. */
const CELEBRATED_MAX = 50

/**
 * Whether to throw confetti for this session, and never again for it.
 *
 * Every set done is worth marking; the same page opened a second time is not.
 * The claim and the check are one call on purpose — split, the caller decides
 * to celebrate and then forgets to record it, which is how "only the first
 * time" quietly becomes "every time".
 */
function claimCelebration(session: PlanSession): boolean {
  if (!session.finishedAt || session.totalSets === 0) return false
  if (session.doneSets < session.totalSets) return false
  try {
    const seen: string[] = JSON.parse(localStorage.getItem(CELEBRATED_KEY) ?? '[]')
    if (seen.includes(session.id)) return false
    localStorage.setItem(CELEBRATED_KEY, JSON.stringify([session.id, ...seen].slice(0, CELEBRATED_MAX)))
    return true
  } catch {
    // A full or unavailable store must not mean confetti on every visit, so
    // the failure is read as "already celebrated".
    return false
  }
}

/**
 * The session flattened into what to draw, in the order it happened.
 *
 * Done in one pass because every timing on the page is a difference between two
 * sets, and the pair being subtracted often straddles an exercise — the wait
 * before the first set of an exercise is the wait after the last set of the one
 * before it. Computed per-chip, the first set of every exercise had nothing to
 * compare against and silently showed no time at all.
 */
function readBack(session: PlanSession): DoneBlock[] {
  const out: DoneBlock[] = []
  // The last set ticked anywhere so far, which is what the next gap measures
  // from regardless of which exercise it belonged to.
  let prevAt: string | undefined

  for (const b of session.snapshot.blocks) {
    const p = blockProgress(session.progress, b.id)
    const chosen = chosenExercises(b, p)
    if (chosen.length === 0) continue

    const exercises: DoneExercise[] = chosen.map(ex => {
      const logs = setsFor(p, ex.id)
      const sets: DoneSet[] = Array.from({ length: ex.sets }, (_, i) => {
        const log = logs[i]
        const row = { n: i + 1, log, prevAt }
        if (log?.done && log.at) prevAt = log.at
        return row
      })
      return { ex, done: doneSetsFor(ex, logs), sets }
    })

    out.push({
      id: b.id,
      label: blockLabel(b),
      exercises,
      skipped: b.options.filter(o => !chosen.includes(o)).map(o => o.name),
      plannedBreakSec: b.restSec,
    })
  }

  // The break after each block is the gap between its last stamp and the next
  // block's first — known only once both have been walked.
  for (let i = 0; i < out.length - 1; i++) {
    const from = lastStamp(out[i])
    const to = firstStamp(out[i + 1])
    const secs = gapSec(from, to)
    if (secs !== undefined) out[i].breakSec = secs
  }
  // The final block has nothing after it, so a planned break there is noise.
  if (out.length > 0) out[out.length - 1].plannedBreakSec = 0
  return out
}

function lastStamp(b: DoneBlock): string | undefined {
  let at: string | undefined
  for (const e of b.exercises) for (const s of e.sets) if (s.log?.done && s.log.at) at = s.log.at
  return at
}

function firstStamp(b: DoneBlock): string | undefined {
  for (const e of b.exercises) for (const s of e.sets) if (s.log?.done && s.log.at) return s.log.at
  return undefined
}

/**
 * One set as it happened: what was done, and how long after the one before.
 *
 * The gap is derived rather than stored — two timestamps already say it, and a
 * duration written beside them is a third number that can disagree.
 */
function SetChip({ n, ex, log, prevAt }: DoneSet & { ex: PlanExercise }) {
  if (!log?.done) {
    // A number and a dash, not the words "not done": it sits in a row of chips
    // that are all about what happened, and a sentence in each empty slot was
    // most of the text on the page.
    return <span className="plan-done-set skipped" title={`Set ${n} was not done`}>{n} · —</span>
  }
  const load = ex.kind === 'time'
    ? durationShort(log.durationSec || ex.durationSec)
    : (log.weightKg || ex.weightKg) > 0
      ? `${trimNum(log.weightKg || ex.weightKg)} kg`
      : 'body'
  const reps = ex.kind === 'time' ? '' : ` × ${log.reps || ex.reps}`
  const gap = gapSec(prevAt, log.at)

  return (
    <span className="plan-done-set">
      <Check size={11} aria-hidden />
      <span className="plan-num">{load}{reps}</span>
      {gap !== undefined && (
        <span className="plan-done-gap plan-num" title={`${durationShort(gap)} after the previous set`}>
          <Timer size={10} aria-hidden /> {durationShort(gap)}
        </span>
      )}
    </span>
  )
}

/** Seconds between two stamps, or undefined when that is not a real number. */
function gapSec(from?: string, to?: string): number | undefined {
  if (!from || !to) return undefined
  const secs = Math.round((Date.parse(to) - Date.parse(from)) / 1000)
  // An hour between two sets is a session someone walked away from, not a rest.
  if (!Number.isFinite(secs) || secs <= 0 || secs > 3600) return undefined
  return secs
}

function startTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}
