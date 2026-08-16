/**
 * Training plans: the shape of a plan, and the small amount of arithmetic the
 * pages agree on.
 *
 * Mirrors backend/internal/plans/model.go. Weights are kilograms everywhere —
 * there is no unit setting, deliberately.
 */

/** One option inside a block, with its own targets. */
export interface PlanExercise {
  id: string
  name: string
  sets: number
  /**
   * Free text: "8", "8-10" and "45 s" are all things people write in a plan.
   * Nothing computes on it, so nothing needs it parsed.
   */
  reps: string
  weightKg: number
  restSec: number
  note: string
}

/**
 * One slot in a day.
 *
 * A single option is a plain exercise; several make it a choose-one — bench
 * press or push-ups — picked at the time. The count is the distinction; there
 * is no kind flag to fall out of step with it.
 */
export interface PlanBlock {
  id: string
  options: PlanExercise[]
}

export interface PlanDay {
  id: string
  name: string
  blocks: PlanBlock[]
}

export interface TrainingPlan {
  id: string
  name: string
  notes: string
  archived: boolean
  /** Present on the single-plan fetch; the list omits it. */
  days?: PlanDay[]
  dayCount: number
  createdAt: string
  updatedAt: string
  lastSessionAt?: string
}

/** One set as performed: whether it was done, and what was actually lifted. */
export interface SetLog {
  done: boolean
  /** Zero means "as planned" — the target weight is used for the total. */
  weightKg: number
  reps?: string
}

export interface BlockProgress {
  /** Index into the block's options. */
  pick: number
  sets: SetLog[]
}

/** Keyed by block id, so an edited plan shifts nothing. */
export interface SessionProgress {
  blocks: Record<string, BlockProgress>
}

export interface PlanSession {
  id: string
  planId?: string
  planName: string
  dayName: string
  /** The day exactly as it stood when the session started. */
  snapshot: PlanDay
  progress: SessionProgress
  startedAt: string
  finishedAt?: string
  doneSets: number
  totalSets: number
  volumeKg: number
  notes: string
  workoutId?: string
}

/** The exercise a block is currently set to, honouring the pick. */
export function chosen(block: PlanBlock, progress?: BlockProgress): PlanExercise | undefined {
  const at = progress?.pick ?? 0
  return block.options[at] ?? block.options[0]
}

/** How many sets of this block are ticked, ignoring any beyond the target. */
export function doneSets(block: PlanBlock, progress?: BlockProgress): number {
  const ex = chosen(block, progress)
  if (!ex || !progress) return 0
  return progress.sets.filter((s, i) => s.done && i < ex.sets).length
}

export function blockComplete(block: PlanBlock, progress?: BlockProgress): boolean {
  const ex = chosen(block, progress)
  return !!ex && doneSets(block, progress) >= ex.sets
}

/** Sets ticked and sets planned across a whole day. */
export function sessionTally(session: PlanSession): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const b of session.snapshot.blocks) {
    const p = session.progress.blocks[b.id]
    const ex = chosen(b, p)
    if (!ex) continue
    total += ex.sets
    done += doneSets(b, p)
  }
  return { done, total }
}

/**
 * "4 × 8 · 60 kg" — the one-line target, with the parts that do not apply left
 * out rather than shown as zero.
 */
export function targetLabel(ex: PlanExercise): string {
  const parts = [`${ex.sets} × ${ex.reps || '—'}`]
  if (ex.weightKg > 0) parts.push(`${trimNum(ex.weightKg)} kg`)
  return parts.join(' · ')
}

/** Weights are often halves; 60 should not render as "60.0". */
export function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

/** "1.2 t" once a session's volume outgrows a readable number of kilograms. */
export function volumeLabel(kg: number): string {
  if (kg <= 0) return '—'
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)} t`
  return `${Math.round(kg)} kg`
}

/** Minutes between two timestamps, for a session's elapsed time. */
export function elapsedMin(from: string, to?: string): number {
  const start = Date.parse(from)
  if (Number.isNaN(start)) return 0
  const end = to ? Date.parse(to) : Date.now()
  return Math.max(0, Math.round((end - start) / 60000))
}

/** "48 min", or "1 h 12" once an hour is up. */
export function durationLabel(min: number): string {
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`
}

/** A blank exercise, for the editor's "add" buttons. */
export function newExercise(): PlanExercise {
  // No id: the server issues one on save and hands it back. Inventing one
  // here would mean two sources of ids that have to agree on a format.
  return { id: '', name: '', sets: 3, reps: '10', weightKg: 0, restSec: 0, note: '' }
}

export function newBlock(): PlanBlock {
  return { id: '', options: [newExercise()] }
}

export function newDay(name: string): PlanDay {
  return { id: '', name, blocks: [] }
}
