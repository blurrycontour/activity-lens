/**
 * Training plans: the shape of a plan, and the small amount of arithmetic the
 * pages agree on.
 *
 * Mirrors backend/internal/plans/model.go. Weights are kilograms everywhere —
 * there is no unit setting, deliberately.
 */

/** What an exercise is measured in. */
export type ExerciseKind =
  /** Sets × reps at a load in kilograms. */
  | 'weight'
  /** Sets × reps against bodyweight; weightKg is any *added* load. */
  | 'body'
  /** Sets × a duration — planks, dead hangs, carries. */
  | 'time'

/** One option inside a block, with its own targets. */
export interface PlanExercise {
  id: string
  name: string
  kind: ExerciseKind
  sets: number
  /**
   * Free text: "8" and "8-10" are both things people write in a plan. Nothing
   * computes on the range, so nothing needs it parsed. Unused when timed.
   */
  reps: string
  /** Seconds per set, for a timed exercise. */
  durationSec: number
  /** The load, or the added load for a bodyweight exercise. */
  weightKg: number
  /** Rest between sets of this exercise. */
  restSec: number
  note: string
}

/**
 * One slot in a day, holding one or more exercises.
 *
 * `required` is the whole of a block's behaviour: 1 is choose-one, the number
 * of options is a superset, and anything between is "two of these three".
 */
export interface PlanBlock {
  id: string
  options: PlanExercise[]
  required: number
  /**
   * The break taken after this block, before starting the next. Distinct from
   * PlanExercise.restSec, the wait between sets of the same exercise.
   */
  restSec: number
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

/** One set as performed. */
export interface SetLog {
  done: boolean
  /** Zero means "as planned" — the target weight is used for the total. */
  weightKg: number
  reps?: string
  /** When the set was ticked, RFC 3339. What lets history show timings. */
  at?: string
  /** How long it was actually held, for a timed exercise. */
  durationSec?: number
}

export interface BlockProgress {
  /** Indices into the block's options: one for a choice, several for a superset. */
  picks: number[]
  /** Set logs per exercise id, so changing your mind keeps both sides' work. */
  sets: Record<string, SetLog[]>
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

export const EMPTY_BLOCK_PROGRESS: BlockProgress = { picks: [], sets: {} }

/** The progress for one block, or an empty record. */
export function blockProgress(progress: SessionProgress, blockId: string): BlockProgress {
  const p = progress.blocks[blockId]
  if (!p) return EMPTY_BLOCK_PROGRESS
  return { picks: p.picks ?? [], sets: p.sets ?? {} }
}

/**
 * Which options are being done in this block.
 *
 * Mirrors Block.EffectivePicks on the server: an untouched block defaults to
 * its first `required` options, so a superset counts everything before
 * anything has been chosen and the totals do not jump around.
 */
export function effectivePicks(block: PlanBlock, p: BlockProgress = EMPTY_BLOCK_PROGRESS): number[] {
  const required = Math.min(Math.max(block.required || 1, 1), block.options.length)
  const seen = new Set<number>()
  const out: number[] = []
  for (const i of p.picks) {
    if (i < 0 || i >= block.options.length || seen.has(i)) continue
    seen.add(i)
    out.push(i)
  }
  for (let i = 0; i < block.options.length && out.length < required; i++) {
    if (!seen.has(i)) { seen.add(i); out.push(i) }
  }
  return out
}

/** The exercises currently being done in this block. */
export function chosenExercises(block: PlanBlock, p?: BlockProgress): PlanExercise[] {
  return effectivePicks(block, p).map(i => block.options[i]).filter(Boolean)
}

export function setsFor(p: BlockProgress, exerciseId: string): SetLog[] {
  return p.sets[exerciseId] ?? []
}

/** Ticked sets for one exercise, ignoring any beyond its target. */
export function doneSetsFor(ex: PlanExercise, sets: SetLog[]): number {
  return sets.filter((s, i) => s.done && i < ex.sets).length
}

export function exerciseComplete(ex: PlanExercise, sets: SetLog[]): boolean {
  return doneSetsFor(ex, sets) >= ex.sets
}

/** True once every exercise the block asks for is finished. */
export function blockComplete(block: PlanBlock, p: BlockProgress = EMPTY_BLOCK_PROGRESS): boolean {
  const chosen = chosenExercises(block, p)
  return chosen.length > 0 && chosen.every(ex => exerciseComplete(ex, setsFor(p, ex.id)))
}

/** Sets ticked and sets planned across a whole day. */
export function sessionTally(session: PlanSession): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const b of session.snapshot.blocks) {
    const p = blockProgress(session.progress, b.id)
    for (const ex of chosenExercises(b, p)) {
      total += ex.sets
      done += doneSetsFor(ex, setsFor(p, ex.id))
    }
  }
  return { done, total }
}

/**
 * The load moved by one set. Mirrors Exercise.setVolume on the server, which
 * is the authority — this is for the running total while a session is open.
 */
export function setVolume(ex: PlanExercise, set: SetLog): number {
  if (ex.kind === 'time') return 0
  const kg = set.weightKg || ex.weightKg
  if (!kg) return 0
  const reps = parseInt(set.reps || ex.reps, 10)
  return Number.isFinite(reps) && reps > 0 ? kg * reps : 0
}

/** Volume across a whole session, for the live figure in the runner. */
export function sessionVolume(session: PlanSession, progress: SessionProgress): number {
  let total = 0
  for (const b of session.snapshot.blocks) {
    const p = blockProgress(progress, b.id)
    for (const ex of chosenExercises(b, p)) {
      setsFor(p, ex.id).forEach((s, i) => {
        if (s.done && i < ex.sets) total += setVolume(ex, s)
      })
    }
  }
  return total
}

/** "4 × 8 · 60 kg", "3 × 8 · body", "3 × 45 s" — whatever the kind calls for. */
export function targetLabel(ex: PlanExercise): string {
  if (ex.kind === 'time') return `${ex.sets} × ${durationShort(ex.durationSec)}`
  const base = `${ex.sets} × ${ex.reps || '—'}`
  if (ex.kind === 'body') return ex.weightKg > 0 ? `${base} · +${trimNum(ex.weightKg)} kg` : `${base} · body`
  return ex.weightKg > 0 ? `${base} · ${trimNum(ex.weightKg)} kg` : base
}

/** What kind of block this is, in the words the editor and runner both use. */
export function blockLabel(block: PlanBlock): string {
  const required = Math.min(Math.max(block.required || 1, 1), block.options.length)
  if (block.options.length <= 1) return ''
  if (required <= 1) return 'Choose one'
  if (required >= block.options.length) return 'Superset · do all'
  return `Do ${required} of ${block.options.length}`
}

/** "45 s", "2:00" — a set duration at a glance. */
export function durationShort(sec: number): string {
  if (sec <= 0) return '—'
  if (sec < 60) return `${sec} s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s ? `${m}:${String(s).padStart(2, '0')}` : `${m} min`
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

/** "Sun 17 Aug · 09:30" — how a session reads in history. */
export function sessionWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const day = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return `${day} · ${time}`
}

/** A blank exercise, for the editor's "add" buttons. */
export function newExercise(): PlanExercise {
  // No id: the server issues one on save and hands it back. Inventing one
  // here would mean two sources of ids that have to agree on a format.
  return { id: '', name: '', kind: 'weight', sets: 3, reps: '10', durationSec: 0, weightKg: 0, restSec: 0, note: '' }
}

export function newBlock(): PlanBlock {
  return { id: '', options: [newExercise()], required: 1, restSec: 0 }
}

export function newDay(name: string): PlanDay {
  return { id: '', name, blocks: [] }
}
