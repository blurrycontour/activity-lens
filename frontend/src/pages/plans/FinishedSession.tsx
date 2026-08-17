import PageHeader from '../../components/PageHeader'
import { Check, Timer } from 'lucide-react'
import {
  blockLabel, blockProgress, chosenExercises, doneSetsFor, durationLabel, durationShort,
  elapsedMin, sessionWhen, setsFor, trimNum, volumeLabel,
  type PlanExercise, type PlanSession, type SetLog,
} from '../../data/plans'

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
  const minutes = elapsedMin(session.startedAt, session.finishedAt)
  return (
    <>
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
              <span className="value">{durationLabel(minutes)}</span>
            </div>
            <div className="stat-chip">
              <span className="label">Volume</span>
              <span className="value">{volumeLabel(session.volumeKg)}</span>
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
          {session.snapshot.blocks.map(b => {
            const p = blockProgress(session.progress, b.id)
            const chosen = chosenExercises(b, p)
            if (chosen.length === 0) return null
            const label = blockLabel(b)
            return (
              <div key={b.id} className="plan-ex plan-ex-read">
                {label && <span className="field-label plan-read-kind">{label}</span>}
                {chosen.map(ex => {
                  const sets = setsFor(p, ex.id)
                  const done = doneSetsFor(ex, sets)
                  return (
                    <div key={ex.id} className="plan-done-ex">
                      <div className="plan-ex-top">
                        <span className="plan-ex-title">{ex.name}</span>
                        <span className={`plan-ex-target plan-num${done >= ex.sets ? ' all-done' : ''}`}>
                          {done} / {ex.sets} sets
                        </span>
                      </div>
                      <div className="plan-done-sets">
                        {Array.from({ length: ex.sets }, (_, i) => (
                          <SetChip key={i} n={i + 1} ex={ex} set={sets[i]} previous={sets[i - 1]} />
                        ))}
                      </div>
                    </div>
                  )
                })}
                {/* What was not chosen is worth seeing too: it says the day
                    had an alternative and which way it went. */}
                {b.options.length > chosen.length && (
                  <span className="plan-read-rest">
                    Instead of {b.options.filter(o => !chosen.includes(o)).map(o => o.name).join(', ')}
                  </span>
                )}
              </div>
            )
          })}
        </div>

        {session.notes && <p className="plan-session-notes">{session.notes}</p>}
      </div>
    </>
  )
}

/**
 * One set as it happened: what was done, and how long after the one before.
 *
 * The gap is derived rather than stored — two timestamps already say it, and a
 * duration written beside them is a third number that can disagree.
 */
function SetChip({ n, ex, set, previous }: {
  n: number
  ex: PlanExercise
  set?: SetLog
  previous?: SetLog
}) {
  if (!set?.done) {
    return <span className="plan-done-set skipped">{n} · not done</span>
  }
  const load = ex.kind === 'time'
    ? durationShort(set.durationSec || ex.durationSec)
    : (set.weightKg || ex.weightKg) > 0
      ? `${trimNum(set.weightKg || ex.weightKg)} kg`
      : 'body'
  const reps = ex.kind === 'time' ? '' : ` × ${set.reps || ex.reps}`

  return (
    <span className="plan-done-set">
      <Check size={11} aria-hidden />
      <span className="plan-num">{load}{reps}</span>
      {gap(previous?.at, set.at) && (
        <span className="plan-done-gap plan-num">
          <Timer size={10} aria-hidden /> {gap(previous?.at, set.at)}
        </span>
      )}
    </span>
  )
}

/** "1:20" between one set and the next, when both were timestamped. */
function gap(from?: string, to?: string): string {
  if (!from || !to) return ''
  const secs = Math.round((Date.parse(to) - Date.parse(from)) / 1000)
  if (!Number.isFinite(secs) || secs <= 0 || secs > 3600) return ''
  return durationShort(secs)
}

function startTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}
