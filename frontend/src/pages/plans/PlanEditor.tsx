import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronUp, Plus, Timer, Trash2, X } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import ConfirmDialog from '../../components/ConfirmDialog'
import ExerciseNameInput from './ExerciseNameInput'
import { adoptIds, withoutDrafts } from './draftPlan'
import { api } from '../../lib/api'
import {
  durationShort, newBlock, newDay, newExercise,
  type ExerciseKind, type PlanBlock, type PlanDay, type PlanExercise, type TrainingPlan,
} from '../../data/plans'

interface Props {
  plan: TrainingPlan
  /** Leaves edit mode, back to reading the plan. */
  onDone: () => void
  /** So the list and the read view see the new structure. */
  onSaved: (p: TrainingPlan) => void
  suggestions: string[]
}

type SaveState = 'clean' | 'saving' | 'saved' | 'failed'

/** What is waiting on a yes: everything destructive goes through one of these. */
type Pending =
  | { kind: 'day'; index: number; name: string }
  | { kind: 'block'; index: number; name: string }
  | { kind: 'option'; block: number; option: number; name: string }

/**
 * Editing a plan: days as tabs, exercises as rows, and a block that can be a
 * choice, a superset or "two of these three".
 *
 * Everything autosaves. A plan editor with a Save button is a plan editor that
 * loses work — this is a screen people leave by locking their phone. The whole
 * day structure goes up on each save rather than a diff, because the server
 * writes it in one transaction; see the API comment.
 */
export default function PlanEditor({ plan, onDone, onSaved, suggestions }: Props) {
  const [days, setDays] = useState<PlanDay[]>(plan.days ?? [])
  const [active, setActive] = useState(0)
  const [save, setSave] = useState<SaveState>('clean')
  const [pending, setPending] = useState<Pending | null>(null)

  const day = days[active]

  // Names already in this plan lead the suggestions, since a plan tends to
  // reuse its own vocabulary before anything else.
  const names = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const d of days) {
      for (const b of d.blocks) {
        for (const o of b.options) {
          const n = o.name.trim()
          if (!n || seen.has(n.toLowerCase())) continue
          seen.add(n.toLowerCase())
          out.push(n)
        }
      }
    }
    for (const n of suggestions) {
      if (!seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); out.push(n) }
    }
    return out
  }, [days, suggestions])

  // --- autosave ----------------------------------------------------------
  const timer = useRef<number | null>(null)
  const queued = useRef<PlanDay[] | null>(null)

  const flush = useCallback(async () => {
    const next = queued.current
    if (!next) return
    queued.current = null
    setSave('saving')
    try {
      const saved = await api.savePlanDays(plan.id, withoutDrafts(next))
      // Ids only, never the whole tree — see draftPlan.ts.
      if (!queued.current) setDays(cur => adoptIds(cur, saved.days ?? []))
      onSaved(saved)
      setSave('saved')
    } catch {
      setSave('failed')
    }
  }, [plan.id, onSaved])

  const edit = useCallback((next: PlanDay[]) => {
    setDays(next)
    queued.current = next
    setSave('saving')
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, 900)
  }, [flush])

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') void flush() }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      if (timer.current) window.clearTimeout(timer.current)
      // Leaving the page is the other way an edit gets stranded.
      void flush()
    }
  }, [flush])

  // --- edits -------------------------------------------------------------

  function patchDay(fn: (d: PlanDay) => PlanDay) {
    edit(days.map((d, i) => (i === active ? fn(d) : d)))
  }

  function patchBlock(index: number, fn: (b: PlanBlock) => PlanBlock) {
    patchDay(d => ({ ...d, blocks: d.blocks.map((b, i) => (i === index ? fn(b) : b)) }))
  }

  function patchExercise(block: number, option: number, patch: Partial<PlanExercise>) {
    patchBlock(block, b => ({
      ...b,
      options: b.options.map((o, i) => (i === option ? { ...o, ...patch } : o)),
    }))
  }

  /** Moves an item within a list, used for both blocks and their options. */
  function reorder<T>(list: T[], from: number, by: number): T[] {
    const to = from + by
    if (to < 0 || to >= list.length) return list
    const next = [...list]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    return next
  }

  function addDay() {
    const next = [...days, newDay(`Day ${days.length + 1}`)]
    edit(next)
    setActive(next.length - 1)
  }

  function confirmRemoval() {
    if (!pending) return
    if (pending.kind === 'day') {
      edit(days.filter((_, i) => i !== pending.index))
      setActive(Math.max(0, active - 1))
    } else if (pending.kind === 'block') {
      patchDay(d => ({ ...d, blocks: d.blocks.filter((_, i) => i !== pending.index) }))
    } else {
      patchBlock(pending.block, b => {
        const options = b.options.filter((_, i) => i !== pending.option)
        // "Do 3 of these" cannot survive dropping to two options.
        return { ...b, options, required: Math.min(b.required, options.length) || 1 }
      })
    }
    setPending(null)
  }

  return (
    <>
      <PageHeader
        title={plan.name}
        subtitle={saveLabel(save)}
        onBack={onDone}
        actions={
          <button className="btn btn-primary" onClick={onDone}>
            <Check size={15} /> Done
          </button>
        }
      />

      <div className="page-content">
        <div className="plan-tabs" role="tablist" aria-label="Days">
          {days.map((d, i) => (
            <button
              key={d.id || i}
              role="tab"
              aria-selected={i === active}
              className={`plan-tab${i === active ? ' active' : ''}`}
              onClick={() => setActive(i)}
            >
              {d.name}
            </button>
          ))}
          <button className="plan-tab add" onClick={addDay}>
            <Plus size={14} /> Day
          </button>
        </div>

        {!day ? (
          <div className="empty-state">
            <p>No days yet. Add one to start writing the plan.</p>
          </div>
        ) : (
          <>
            <div className="plan-day-head">
              <input
                className="input"
                value={day.name}
                aria-label="Day name"
                onChange={e => patchDay(d => ({ ...d, name: e.target.value }))}
              />
              <button
                className="btn-icon"
                onClick={() => setPending({ kind: 'day', index: active, name: day.name })}
                aria-label={`Remove ${day.name}`}
              >
                <Trash2 size={15} />
              </button>
            </div>

            <div className="plan-edit-rows">
              {day.blocks.map((block, bi) => (
                <div key={block.id || bi}>
                  <BlockEditor
                    block={block}
                    first={bi === 0}
                    last={bi === day.blocks.length - 1}
                    suggestions={names}
                    onMove={by => patchDay(d => ({ ...d, blocks: reorder(d.blocks, bi, by) }))}
                    onMoveOption={(oi, by) => patchBlock(bi, b => ({ ...b, options: reorder(b.options, oi, by) }))}
                    onPatch={(oi, patch) => patchExercise(bi, oi, patch)}
                    onRequired={n => patchBlock(bi, b => ({ ...b, required: n }))}
                    onRemove={() => setPending({
                      kind: 'block', index: bi,
                      name: block.options.map(o => o.name).filter(Boolean).join(' / ') || 'this exercise',
                    })}
                    onRemoveOption={oi => setPending({
                      kind: 'option', block: bi, option: oi,
                      name: block.options[oi].name || 'this option',
                    })}
                    onAddOption={() => patchBlock(bi, b => ({ ...b, options: [...b.options, newExercise()] }))}
                  />
                  <BreakRow
                    seconds={block.restSec}
                    last={bi === day.blocks.length - 1}
                    onChange={secs => patchBlock(bi, b => ({ ...b, restSec: secs }))}
                  />
                </div>
              ))}

              <button
                className="plan-add-row"
                onClick={() => patchDay(d => ({ ...d, blocks: [...d.blocks, newBlock()] }))}
              >
                <Plus size={15} /> Add exercise
              </button>
            </div>
          </>
        )}
      </div>

      {pending && (
        <ConfirmDialog
          title={pending.kind === 'day' ? `Remove ${pending.name}?` : `Remove ${pending.name}?`}
          message={pending.kind === 'day'
            ? 'The day and every exercise in it go. Sessions already run keep their own copy.'
            : 'It is removed from this plan. Sessions already run keep their own copy.'}
          confirmLabel="Remove"
          danger
          onConfirm={confirmRemoval}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  )
}

function saveLabel(s: SaveState): string {
  switch (s) {
    case 'saving': return 'Saving…'
    case 'saved': return 'Saved'
    case 'failed': return 'Could not save — check your connection'
    default: return 'Autosaves as you type'
  }
}

/**
 * The break between one exercise and the next.
 *
 * Presented as a chip on a rule between the two cards, because that is what it
 * is: a gap in the day, not a property of either exercise. Adding one asks for
 * a number of seconds and nothing else.
 */
function BreakRow({ seconds, last, onChange }: {
  seconds: number
  last: boolean
  onChange: (s: number) => void
}) {
  const [editing, setEditing] = useState(false)
  if (last) return null

  if (!seconds && !editing) {
    return (
      <div className="plan-break-line">
        <button className="plan-break-chip add" onClick={() => setEditing(true)}>
          <Timer size={12} /> Add a break
        </button>
      </div>
    )
  }
  return (
    <div className="plan-break-line">
      <div className="plan-break-chip">
        <Timer size={12} aria-hidden />
        <input
          className="input"
          type="number"
          inputMode="numeric"
          min="0"
          step="15"
          autoFocus={editing && !seconds}
          value={seconds || ''}
          placeholder="90"
          aria-label="Break before the next exercise, in seconds"
          onChange={e => onChange(Math.max(0, parseInt(e.target.value, 10) || 0))}
          onBlur={() => setEditing(false)}
        />
        <span>s break</span>
        <button
          className="btn-icon"
          onClick={() => { onChange(0); setEditing(false) }}
          aria-label="Remove this break"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  )
}

interface BlockProps {
  block: PlanBlock
  first: boolean
  last: boolean
  suggestions: string[]
  onMove: (by: number) => void
  onMoveOption: (option: number, by: number) => void
  onPatch: (option: number, patch: Partial<PlanExercise>) => void
  onRequired: (n: number) => void
  onRemove: () => void
  onRemoveOption: (option: number) => void
  onAddOption: () => void
}

/**
 * One slot in the day.
 *
 * A single exercise is a plain card. Adding a second turns it into a group,
 * and the group says how many of its exercises to do: one is the alternative
 * it used to be, all of them is a superset, and anything between is a choice
 * with a count.
 */
function BlockEditor({
  block, first, last, suggestions,
  onMove, onMoveOption, onPatch, onRequired, onRemove, onRemoveOption, onAddOption,
}: BlockProps) {
  const group = block.options.length > 1
  const required = Math.min(Math.max(block.required || 1, 1), block.options.length)

  return (
    <div className={group ? 'plan-group' : 'plan-edit-block'}>
      <div className="plan-block-head">
        {/* Order is two buttons rather than a drag: dragging inside a
            vertically scrolling page fights the scroll on a touch screen, and
            this is unambiguous with one thumb. */}
        <div className="plan-move">
          <button className="btn-icon" disabled={first} onClick={() => onMove(-1)} aria-label="Move up">
            <ChevronUp size={15} />
          </button>
          <button className="btn-icon" disabled={last} onClick={() => onMove(1)} aria-label="Move down">
            <ChevronDown size={15} />
          </button>
        </div>

        {group && (
          /* One select saying the whole thing, rather than a number between
             two words: "Do [2] of 3" needed three elements and a hint beside
             them to explain itself, and read as arithmetic. */
          <select
            className="input plan-required"
            value={required}
            aria-label="How many of these exercises to do"
            onChange={e => onRequired(parseInt(e.target.value, 10) || 1)}
          >
            {block.options.map((_, i) => (
              <option key={i} value={i + 1}>
                {i === 0
                  ? 'Choose one'
                  : i + 1 === block.options.length
                    ? `Superset · do all ${i + 1}`
                    : `Do ${i + 1} of ${block.options.length}`}
              </option>
            ))}
          </select>
        )}

        <button className="btn-icon plan-block-x" onClick={onRemove} aria-label="Remove this exercise">
          <X size={15} />
        </button>
      </div>

      {block.options.map((ex, oi) => (
        <ExerciseFields
          key={ex.id || oi}
          ex={ex}
          suggestions={suggestions}
          showMove={group}
          first={oi === 0}
          last={oi === block.options.length - 1}
          onMove={by => onMoveOption(oi, by)}
          onPatch={patch => onPatch(oi, patch)}
          onRemove={() => (group ? onRemoveOption(oi) : onRemove())}
        />
      ))}

      <button className="plan-add-alt" onClick={onAddOption}>
        <Plus size={13} /> {group ? 'Add an option' : 'Add an alternative'}
      </button>
    </div>
  )
}

/** The fields for one exercise, which depend on what it is measured in. */
function ExerciseFields({ ex, suggestions, showMove, first, last, onMove, onPatch, onRemove }: {
  ex: PlanExercise
  suggestions: string[]
  showMove: boolean
  first: boolean
  last: boolean
  onMove: (by: number) => void
  onPatch: (patch: Partial<PlanExercise>) => void
  onRemove: () => void
}) {
  const timed = ex.kind === 'time'
  return (
    <div className="plan-erow">
      {showMove && (
        <div className="plan-move plan-move-option">
          <button className="btn-icon" disabled={first} onClick={() => onMove(-1)} aria-label="Move up">
            <ChevronUp size={14} />
          </button>
          <button className="btn-icon" disabled={last} onClick={() => onMove(1)} aria-label="Move down">
            <ChevronDown size={14} />
          </button>
        </div>
      )}

      <ExerciseNameInput
        className="input plan-ename"
        value={ex.name}
        suggestions={suggestions}
        onChange={v => onPatch({ name: v })}
      />

      <button className="btn-icon plan-erow-x" onClick={onRemove} aria-label={`Remove ${ex.name || 'this exercise'}`}>
        <X size={15} />
      </button>

      <div className="plan-efields">
        <label>
          <span className="field-label">Type</span>
          {/* What the exercise is measured in, which decides the rest of the
              row. Before this, a plank could only be written by typing "45 s"
              into a reps box beside a kilograms field it had no use for. */}
          <select
            className="input plan-kind"
            value={ex.kind}
            aria-label="How this exercise is measured"
            onChange={e => onPatch({ kind: e.target.value as ExerciseKind })}
          >
            <option value="weight">Weight</option>
            <option value="body">Bodyweight</option>
            <option value="time">Time</option>
          </select>
        </label>

        <label>
          <span className="field-label">Sets</span>
          <input
            className="input" type="number" inputMode="numeric" min="1" max="50"
            value={ex.sets}
            onChange={e => onPatch({ sets: Math.max(1, parseInt(e.target.value, 10) || 1) })}
          />
        </label>

        {timed ? (
          <label>
            <span className="field-label">Hold</span>
            <input
              className="input" type="number" inputMode="numeric" min="0" step="5"
              value={ex.durationSec || ''}
              placeholder="45"
              aria-label="Seconds per set"
              onChange={e => onPatch({ durationSec: Math.max(0, parseInt(e.target.value, 10) || 0) })}
            />
          </label>
        ) : (
          <label>
            <span className="field-label">Reps</span>
            {/* Text, not a number: "8-10" is a real answer. */}
            <input
              className="input" value={ex.reps} placeholder="8"
              onChange={e => onPatch({ reps: e.target.value })}
            />
          </label>
        )}

        {!timed && (
          <label>
            <span className="field-label">{ex.kind === 'body' ? '+kg' : 'kg'}</span>
            <input
              className="input" type="number" inputMode="decimal" step="0.5" min="0"
              value={ex.weightKg || ''}
              placeholder={ex.kind === 'body' ? '0' : '—'}
              aria-label={ex.kind === 'body' ? 'Added weight in kilograms' : 'Weight in kilograms'}
              onChange={e => onPatch({ weightKg: parseFloat(e.target.value) || 0 })}
            />
          </label>
        )}

        <label>
          <span className="field-label">Rest</span>
          {/* Between sets of this exercise, as opposed to the break between
              exercises on the rule below the card. Ticking a set starts it. */}
          <input
            className="input" type="number" inputMode="numeric" min="0" step="15"
            value={ex.restSec || ''}
            placeholder="—"
            aria-label="Rest between sets, in seconds"
            title={ex.restSec > 0 ? `${durationShort(ex.restSec)} between sets` : undefined}
            onChange={e => onPatch({ restSec: Math.max(0, parseInt(e.target.value, 10) || 0) })}
          />
        </label>
      </div>
    </div>
  )
}
