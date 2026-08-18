import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Check, MoreVertical, Plus, Timer, Trash2, X } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import ConfirmDialog from '../../components/ConfirmDialog'
import Dropdown from '../../components/Dropdown'
import MenuButton from '../../components/MenuButton'
import ExerciseNameInput from './ExerciseNameInput'
import { adoptIds, withoutDrafts } from './draftPlan'
import { api } from '../../lib/api'
import {
  SECTIONS, blockRequired, durationShort, newBlock, newDay, newExercise, requiredPhrase,
  type BlockSection, type ExerciseKind, type PlanBlock, type PlanDay, type PlanExercise, type TrainingPlan,
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
        /* Where the read view's options menu is, rather than wrapped onto a
           line of its own below the subtitle — leaving edit mode is the same
           kind of action as entering it, and it belongs in the same place. */
        compactActions
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
                    onSection={sec => patchBlock(bi, b => ({ ...b, section: sec }))}
                    onRemove={() => setPending({
                      kind: 'block', index: bi,
                      name: block.options.map(o => o.name).filter(Boolean).join(' / ') || 'this exercise',
                    })}
                    onRemoveOption={oi => setPending({
                      kind: 'option', block: bi, option: oi,
                      name: block.options[oi].name || 'this option',
                    })}
                    onAddOption={() => patchBlock(bi, b => ({
                      ...b,
                      options: [...b.options, b.section
                        ? { ...newExercise(), kind: 'time' as const, sets: 1, durationSec: 300 }
                        : newExercise()],
                    }))}
                  />
                  <BreakRow
                    seconds={block.restSec}
                    last={bi === day.blocks.length - 1}
                    onChange={secs => patchBlock(bi, b => ({ ...b, restSec: secs }))}
                  />
                </div>
              ))}

              <div className="plan-add-row-group">
                <button
                  className="plan-add-row"
                  onClick={() => patchDay(d => ({ ...d, blocks: [...d.blocks, newBlock()] }))}
                >
                  <Plus size={15} /> Add exercise
                </button>
                {/* A warm-up is not an exercise with different numbers in it —
                    it is a few minutes at one end of the day. Added as its own
                    thing so it arrives already timed and already looking
                    different from the working sets. */}
                <button
                  className="plan-add-row plan-add-section"
                  onClick={() => patchDay(d => ({ ...d, blocks: [...d.blocks, newBlock('warmup')] }))}
                >
                  <Plus size={15} /> Add warm-up or stretch
                </button>
              </div>
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
  // Whether the chip is a field at all, as opposed to the "add" button. Held
  // separately from the value: backspacing a 90 down to nothing used to take
  // the whole control away mid-edit, because an empty field and no break at
  // all were the same state.
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
          onFocus={() => setEditing(true)}
          onChange={e => onChange(Math.max(0, parseInt(e.target.value, 10) || 0))}
          // Leaving an empty field is what removes the break — that is a
          // decision, where a keystroke on the way to another number is not.
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
  onSection: (s: BlockSection) => void
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
  onMove, onMoveOption, onPatch, onRequired, onSection, onRemove, onRemoveOption, onAddOption,
}: BlockProps) {
  const group = block.options.length > 1

  return (
    <div className={block.section ? 'plan-group plan-section' : group ? 'plan-group' : 'plan-edit-block'}>
      {(group || block.section) && (
        <div className="plan-block-head">
          {block.section && (
            <Dropdown
              value={block.section}
              onChange={(v: BlockSection) => onSection(v)}
              ariaLabel="What this section is"
              options={SECTIONS.map(x => ({ value: x.id, label: x.label }))}
            />
          )}
          {/* One control saying the whole thing, rather than a number between
              two words: "Do [2] of 3" needed three elements and a hint beside
              them to explain itself, and read as arithmetic. The app's own
              dropdown, so it looks like every other picker in the product. */}
          {group && <Dropdown
            value={blockRequired(block)}
            onChange={onRequired}
            ariaLabel="How many of these exercises to do"
            options={block.options.map((_, i) => ({
              value: i + 1,
              label: requiredPhrase(i + 1, block.options.length),
            }))}
          />}
          <RowMenu
            label="Block options"
            first={first}
            last={last}
            onMove={onMove}
            onRemove={onRemove}
            removeLabel="Remove block"
          />
        </div>
      )}

      {block.options.map((ex, oi) => (
        <ExerciseFields
          key={ex.id || oi}
          ex={ex}
          suggestions={suggestions}
          /* In a group the arrows reorder within the group and the block's own
             menu moves the block. A lone exercise *is* the block, so its menu
             moves the block — otherwise a plain exercise could not be moved
             without first being turned into a group. */
          first={group ? oi === 0 : first}
          last={group ? oi === block.options.length - 1 : last}
          onMove={by => (group ? onMoveOption(oi, by) : onMove(by))}
          onPatch={patch => onPatch(oi, patch)}
          onRemove={() => (group ? onRemoveOption(oi) : onRemove())}
          /* A section is time work, so the Type picker is not a choice it
             has: hidden rather than shown-and-locked, which would be a
             control that exists to be disabled. */
          timedOnly={!!block.section}
        />
      ))}

      {/* Not "an alternative" any more: a second exercise here may be a swap,
          a superset partner or one of four to pick two from. What it has in
          common is the block. */}
      <button className="plan-add-alt" onClick={onAddOption}>
        <Plus size={13} /> Add to this block
      </button>
    </div>
  )
}

/**
 * The row's own menu: move it, or remove it.
 *
 * Two arrows and an X sitting permanently on every card was three controls per
 * exercise competing with the fields that are the point of the screen, and on a
 * phone they pushed the name into a stub. A menu is one target, and it can say
 * "Move up" in words rather than leaving a greyed chevron to be decoded.
 */
function RowMenu({ label, first, last, onMove, onRemove, removeLabel }: {
  label: string
  first: boolean
  last: boolean
  onMove: (by: number) => void
  onRemove: () => void
  removeLabel: string
}) {
  return (
    <MenuButton icon={<MoreVertical size={15} />} label={label}>
      <button className="options-menu-item" disabled={first} onClick={() => onMove(-1)}>
        <ArrowUp size={14} /> Move up
      </button>
      <button className="options-menu-item" disabled={last} onClick={() => onMove(1)}>
        <ArrowDown size={14} /> Move down
      </button>
      <button className="options-menu-item danger" onClick={onRemove}>
        <Trash2 size={14} /> {removeLabel}
      </button>
    </MenuButton>
  )
}

/** The fields for one exercise, which depend on what it is measured in. */
function ExerciseFields({ ex, suggestions, first, last, timedOnly, onMove, onPatch, onRemove }: {
  ex: PlanExercise
  suggestions: string[]
  first: boolean
  last: boolean
  /** Inside a section, where everything is measured in seconds. */
  timedOnly?: boolean
  onMove: (by: number) => void
  onPatch: (patch: Partial<PlanExercise>) => void
  onRemove: () => void
}) {
  const timed = timedOnly || ex.kind === 'time'
  return (
    <div className="plan-erow">
      {/* Every other field on this row is labelled; the one that says what the
          exercise *is* was the only bare box on the screen. */}
      <label className="plan-ename-field">
        <span className="field-label">Exercise name</span>
        <ExerciseNameInput
          className="input plan-ename"
          value={ex.name}
          suggestions={suggestions}
          onChange={v => onPatch({ name: v })}
        />
      </label>

      <div className="plan-erow-menu">
        <RowMenu
          label={`Options for ${ex.name || 'this exercise'}`}
          first={first}
          last={last}
          onMove={onMove}
          onRemove={onRemove}
          removeLabel="Remove"
        />
      </div>

      <div className="plan-efields">
        {!timedOnly && <label className="plan-kind-field">
          <span className="field-label">Type</span>
          {/* What the exercise is measured in, which decides the rest of the
              row. Before this, a plank could only be written by typing "45 s"
              into a reps box beside a kilograms field it had no use for. */}
          <Dropdown
            block
            value={ex.kind}
            onChange={(k: ExerciseKind) => onPatch({ kind: k })}
            ariaLabel="How this exercise is measured"
            options={[
              { value: 'weight', label: 'Weight' },
              { value: 'body', label: 'Bodyweight' },
              { value: 'time', label: 'Time' },
            ]}
          />
        </label>}

        <label>
          <span className="field-label">Sets</span>
          {/* Empty while you retype it. Clamping to 1 on every keystroke meant
              the field could not be cleared at all: deleting the 3 in "30" put
              a 3 straight back, so the only way to reach 5 was to select the
              text first. The floor is applied when you leave instead. */}
          <input
            className="input" type="number" inputMode="numeric" min="1" max="50"
            value={ex.sets || ''}
            placeholder="3"
            onChange={e => onPatch({ sets: Math.min(50, Math.max(0, parseInt(e.target.value, 10) || 0)) })}
            onBlur={() => { if (ex.sets < 1) onPatch({ sets: 1 }) }}
          />
        </label>

        {timed ? (
          <label>
            <span className="field-label">Duration</span>
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
