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
  /**
   * The pause after this exercise before the next one *in the same block* —
   * the minute between the movements of a superset. The third of three
   * distinct waits, and neither of the others could be it: `restSec` is
   * between sets of this exercise, and `PlanBlock.restSec` is after the whole
   * block.
   */
  breakSec: number
  note: string
}

/**
 * What a block is, when it is not working sets.
 *
 * On the block rather than the day: a warm-up is five minutes at the top of a
 * day that also has working sets, and stretching turns up at both ends.
 */
export type BlockSection = '' | 'warmup' | 'cooldown' | 'stretch'

/** The label and colour role each section wears, in one place. */
export const SECTIONS: { id: Exclude<BlockSection, ''>; label: string }[] = [
  { id: 'warmup', label: 'Warm-up' },
  { id: 'cooldown', label: 'Cool-down' },
  { id: 'stretch', label: 'Stretching' },
]

export function sectionLabel(s: BlockSection): string {
  return SECTIONS.find(x => x.id === s)?.label ?? ''
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
  /** Empty for an ordinary block of exercises. Sections are always timed. */
  section: BlockSection
  /**
   * Lets a section stand on its own with no exercises in it — "warm up for ten
   * minutes". Zero means its exercises say how long it takes, which is every
   * ordinary block.
   */
  durationSec: number
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
  /**
   * How many sets a run through every day of this plan would tick off.
   *
   * Counts the options a session picks by default, so a block offering "2 of
   * these 3" contributes two rather than three — the card and the runner have
   * to agree about the same workout. Absent from a server older than the field.
   */
  setCount?: number
  createdAt: string
  updatedAt: string
  lastSessionAt?: string
  /** Who, beyond you, can see this plan. Empty/absent means private. */
  visibility?: 'private' | 'public'
  /** How many people it's been shared with directly — the owner's own count. */
  sharedWithCount?: number
  /**
   * The plan's author, present only when it is not you — a plan fetched from
   * Discover or opened by its id when someone else's. Absent on your own.
   */
  owner?: { id: number; username: string; displayName: string; avatarPath: string }
  /** Who this was sent to, on your own profile. The mirror of `owner`: that
   *  says who it came from, this says where it went. */
  sharedWith?: { id: number; username: string; displayName: string; avatarPath: string }[]
  /**
   * Whether the single-plan fetch found you own it. Present only on that
   * response (never on a list row), same convention as Workout.isOwner —
   * undefined there means "assume yours", which every call site before
   * sharing existed already does correctly.
   */
  isOwner?: boolean
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
  /**
   * When the set was begun, RFC 3339 — written by the first tap.
   *
   * A set has three states in the runner: waiting, under way, done. This is
   * what tells the first two apart, and what survives a reload so a session
   * picked up again knows which set was in the middle of being performed.
   */
  startedAt?: string
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
  /**
   * Load moved, in kilograms, as the server records it.
   *
   * Not shown anywhere. Volume is a number that only means something once you
   * already know what it means, and it was sitting on three screens next to
   * figures — sets, time — that speak for themselves. Kept on the wire because
   * dropping the column buys nothing and it is the sort of thing a training
   * app is asked for again.
   */
  volumeKg: number
  notes: string
  workoutId?: string
  /** See TrainingPlan — same fields, same meaning, a session's own. */
  visibility?: 'private' | 'public'
  sharedWithCount?: number
  owner?: { id: number; username: string; displayName: string; avatarPath: string }
  sharedWith?: { id: number; username: string; displayName: string; avatarPath: string }[]
  isOwner?: boolean
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
  const required = blockRequired(block)
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

/**
 * A section with no exercises: just a length of time.
 *
 * The one block shape that is real while empty, so every list that walks
 * blocks has to know about it rather than skipping anything without options.
 */
export function isBareSection(block: PlanBlock): boolean {
  return !!block.section && block.options.length === 0 && block.durationSec > 0
}

/**
 * The one thing a bare section is, expressed as an exercise.
 *
 * "Warm up for ten minutes" behaves exactly like a single timed set of ten
 * minutes, so it is given the shape of one rather than a parallel code path
 * through the runner, the tally and the completion check. Its id is the
 * block's, since there is no exercise row to take an id from.
 */
export function sectionExercise(block: PlanBlock): PlanExercise {
  return {
    id: block.id,
    name: sectionLabel(block.section),
    kind: 'time',
    sets: 1,
    reps: '',
    durationSec: block.durationSec,
    weightKg: 0,
    restSec: 0,
    breakSec: 0,
    note: '',
  }
}

/** The exercises currently being done in this block. */
export function chosenExercises(block: PlanBlock, p?: BlockProgress): PlanExercise[] {
  if (isBareSection(block)) return [sectionExercise(block)]
  return effectivePicks(block, p).map(i => block.options[i]).filter(Boolean)
}

export function setsFor(p: BlockProgress, exerciseId: string): SetLog[] {
  return p.sets[exerciseId] ?? []
}

/** Ticked sets for one exercise, ignoring any beyond its target. */
export function doneSetsFor(ex: PlanExercise, sets: SetLog[]): number {
  return sets.filter((s, i) => s.done && i < ex.sets).length
}

/**
 * How many sets are done from the start, unbroken.
 *
 * Sets are ticked in order, so this is also the index of the next one. Ticking
 * set 3 before set 1 recorded a session nobody performed and made every derived
 * timing — the gap between sets, the rest that starts on a tick — meaningless.
 */
export function leadingDone(sets: SetLog[]): number {
  let n = 0
  while (sets[n]?.done) n++
  return n
}

/**
 * What state a set is in.
 *
 * Three, not two. A set is a thing you are in the middle of for a minute or so,
 * and a single tick could only say whether it had happened — which left the
 * timer for a plank with nothing to start from, and the card with no way to
 * show what you were actually doing right now.
 */
export type SetState = 'idle' | 'running' | 'done'

export function setState(sets: SetLog[], index: number): SetState {
  const s = sets[index]
  if (s?.done) return 'done'
  return s?.startedAt ? 'running' : 'idle'
}

/**
 * Whether a set may be tapped.
 *
 * Only the one at the front of the queue — start it, then finish it — and the
 * last one finished, so a mis-tap can be taken back. Sets stay a run from the
 * start, which is what every timing derived from them assumes.
 */
export function setTappable(sets: SetLog[], index: number): boolean {
  const n = leadingDone(sets)
  return index === n || index === n - 1
}

/**
 * The block being worked on: the first one not finished.
 *
 * Drives the one card that wears the accent while a session runs. Reading it
 * from progress rather than storing it means it cannot fall out of step with
 * what has actually been ticked.
 */
export function currentBlockId(session: PlanSession, progress: SessionProgress): string {
  for (const b of session.snapshot.blocks) {
    if (!blockComplete(b, blockProgress(progress, b.id))) return b.id
  }
  return ''
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
 * What is being worked on right now: the first chosen exercise with sets left.
 *
 * Used by the phone's ongoing notification, which has one line to say where in
 * the session you are.
 */
export function currentExercise(session: PlanSession, progress: SessionProgress): string {
  for (const b of session.snapshot.blocks) {
    const p = blockProgress(progress, b.id)
    for (const ex of chosenExercises(b, p)) {
      if (!exerciseComplete(ex, setsFor(p, ex.id))) return ex.name
    }
  }
  return ''
}

/**
 * The exercise after the one being done, or "" when this is the last.
 *
 * For the notification's expanded view, which has room for one more line than
 * the shade's collapsed one — and "next: Lat pulldown" is the line worth
 * having while resting, since it is the thing you are resting *for*.
 */
export function nextExercise(session: PlanSession, progress: SessionProgress): string {
  let seenCurrent = false
  for (const b of session.snapshot.blocks) {
    const p = blockProgress(progress, b.id)
    for (const ex of chosenExercises(b, p)) {
      if (exerciseComplete(ex, setsFor(p, ex.id))) continue
      if (seenCurrent) return ex.name
      seenCurrent = true
    }
  }
  return ''
}

/** "4 × 8 · 60 kg", "3 × 8 · body", "3 × 45 s" — whatever the kind calls for. */
export function targetLabel(ex: PlanExercise): string {
  if (ex.kind === 'time') return `${ex.sets} × ${durationShort(ex.durationSec)}`
  const base = `${ex.sets} × ${ex.reps || '—'}`
  if (ex.kind === 'body') return ex.weightKg > 0 ? `${base} · +${trimNum(ex.weightKg)} kg` : `${base} · body`
  return ex.weightKg > 0 ? `${base} · ${trimNum(ex.weightKg)} kg` : base
}

/**
 * How a block reads, from how many of its exercises it asks for.
 *
 * One phrase, one function. The editor's picker and the read, run and history
 * views all print this: they said "Choose one", "Superset · do all" and
 * "Do 2 of 4" for what is a single count, so the same block described itself
 * three different ways depending on which screen you were looking at.
 */
export function requiredPhrase(required: number, total: number): string {
  if (total <= 1) return ''
  if (required >= total) return `Superset · all ${total}`
  return `Choose ${required} of ${total}`
}

/** The number of a block's options actually being done. */
export function blockRequired(block: PlanBlock): number {
  return Math.min(Math.max(block.required || 1, 1), Math.max(block.options.length, 1))
}

/** What kind of block this is, in the words every plans screen uses. */
export function blockLabel(block: PlanBlock): string {
  return requiredPhrase(blockRequired(block), block.options.length)
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

/** Seconds between two timestamps, or since `from` when still running. */
export function elapsedSec(from: string, to?: string): number {
  const start = Date.parse(from)
  if (Number.isNaN(start)) return 0
  const end = to ? Date.parse(to) : Date.now()
  return Math.max(0, Math.round((end - start) / 1000))
}

/** Minutes between two timestamps, for a session's elapsed time. */
export function elapsedMin(from: string, to?: string): number {
  return Math.round(elapsedSec(from, to) / 60)
}

/**
 * A session's length as a clock: "12:40" under an hour, "1:05:30" over it.
 *
 * Minutes alone were wrong at both ends. A session two minutes old read "2 min"
 * while you were watching the seconds, and one over an hour read "1 h 05",
 * which is a spelling of a time nobody uses. A clock reads the same on the
 * summary card as it does on the phone's own timer.
 */
export function clockLabel(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  const mm = String(Math.floor(s / 60) % 60).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  const h = Math.floor(s / 3600)
  return h > 0 ? `${h}:${mm}:${ss}` : `${Math.floor(s / 60)}:${ss}`
}

/** "48 min", or "1 h 12" once an hour is up. Used where a rough length reads better. */
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
  return { id: '', name: '', kind: 'weight', sets: 3, reps: '10', durationSec: 0, weightKg: 0, restSec: 0, breakSec: 0, note: '' }
}

export function newBlock(section: BlockSection = ''): PlanBlock {
  // A section starts as a bare duration — "warm up for five minutes" — because
  // that is what most of them are. Exercises can be added if it needs them.
  if (section) return { id: '', options: [], required: 1, restSec: 0, section, durationSec: 300 }
  return { id: '', options: [newExercise()], required: 1, restSec: 0, section: '', durationSec: 0 }
}

export function newDay(name: string): PlanDay {
  return { id: '', name, blocks: [] }
}
