import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, GripVertical, Pencil, Play, Plus, Timer, Trash2, X } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import ConfirmDialog from '../../components/ConfirmDialog'
import ExerciseNameInput, { recentExerciseNames, rememberExerciseNames } from './ExerciseNameInput'
import { adoptIds, namesIn, withoutDrafts } from './draftPlan'
import { api } from '../../lib/api'
import {
  newBlock, newDay, newExercise,
  type PlanBlock, type PlanDay, type PlanExercise, type TrainingPlan,
} from '../../data/plans'

interface Props {
  plan: TrainingPlan
  onBack: () => void
  onStart: (dayId: string) => void
  onDeleted: () => void
  /** So the list behind can show the new name and day count. */
  onSaved: (p: TrainingPlan) => void
}

type SaveState = 'clean' | 'saving' | 'saved' | 'failed'

/**
 * Building and editing a plan: days as tabs, exercises as rows, alternatives
 * as a bordered choose-one group.
 *
 * Everything autosaves. A plan editor with a Save button is a plan editor that
 * loses work — this is a screen people leave by locking their phone. The whole
 * day structure goes up on each save rather than a diff, because the server
 * writes it in one transaction; see the API comment.
 */
export default function PlanEditor({ plan, onBack, onStart, onDeleted, onSaved }: Props) {
  const [days, setDays] = useState<PlanDay[]>(plan.days ?? [])
  const [active, setActive] = useState(0)
  const [name, setName] = useState(plan.name)
  const [renaming, setRenaming] = useState(false)
  const [save, setSave] = useState<SaveState>('clean')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  const day = days[active]

  // Every name in this plan, plus whatever this device has typed before.
  const suggestions = useMemo(() => {
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
    for (const n of recentExerciseNames()) {
      if (!seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); out.push(n) }
    }
    return out
  }, [days])

  // --- autosave ----------------------------------------------------------
  const timer = useRef<number | null>(null)
  const pending = useRef<PlanDay[] | null>(null)

  const flush = useCallback(async () => {
    const next = pending.current
    if (!next) return
    pending.current = null
    setSave('saving')
    try {
      const saved = await api.savePlanDays(plan.id, withoutDrafts(next))
      // Ids only, never the whole tree.
      //
      // The server drops rows with no exercise name — a half-typed one is not
      // a plan yet — so adopting its answer wholesale deleted the row the
      // moment "Add exercise" was tapped, before there was anything to type
      // into. Copying the ids across keeps what is on screen while still
      // letting the next save update those rows instead of duplicating them.
      if (!pending.current) setDays(cur => adoptIds(cur, saved.days ?? []))
      rememberExerciseNames(namesIn(next))
      onSaved(saved)
      setSave('saved')
    } catch {
      setSave('failed')
    }
  }, [plan.id, onSaved])

  const edit = useCallback((next: PlanDay[]) => {
    setDays(next)
    pending.current = next
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

  async function renamePlan(next: string) {
    const clean = next.trim() || plan.name
    setName(clean)
    setRenaming(false)
    try {
      onSaved(await api.patchPlan(plan.id, { name: clean }))
    } catch {
      setSave('failed')
    }
  }

  // --- day edits ---------------------------------------------------------

  function patchDay(fn: (d: PlanDay) => PlanDay) {
    edit(days.map((d, i) => (i === active ? fn(d) : d)))
  }

  function patchBlock(blockIndex: number, fn: (b: PlanBlock) => PlanBlock) {
    patchDay(d => ({ ...d, blocks: d.blocks.map((b, i) => (i === blockIndex ? fn(b) : b)) }))
  }

  function patchExercise(blockIndex: number, optionIndex: number, patch: Partial<PlanExercise>) {
    patchBlock(blockIndex, b => ({
      ...b,
      options: b.options.map((o, i) => (i === optionIndex ? { ...o, ...patch } : o)),
    }))
  }

  function addDay() {
    const next = [...days, newDay(`Day ${days.length + 1}`)]
    edit(next)
    setActive(next.length - 1)
  }

  function removeDay() {
    const next = days.filter((_, i) => i !== active)
    edit(next)
    setActive(Math.max(0, active - 1))
  }

  function move(blockIndex: number, by: number) {
    const to = blockIndex + by
    if (!day || to < 0 || to >= day.blocks.length) return
    const blocks = [...day.blocks]
    const [moved] = blocks.splice(blockIndex, 1)
    blocks.splice(to, 0, moved)
    patchDay(d => ({ ...d, blocks }))
  }

  async function deletePlan() {
    setBusy(true)
    try {
      await api.deletePlan(plan.id)
      onDeleted()
    } catch {
      setBusy(false)
      setConfirmDelete(false)
    }
  }

  const startable = !!day && day.blocks.some(b => b.options.some(o => o.name.trim()))

  return (
    <>
      <PageHeader
        title={name}
        subtitle={saveLabel(save)}
        onBack={onBack}
        /* The title is the plan name and is edited in place, so the page does
           not carry a second field saying the same thing under a label. */
        titleAction={
          <button className="btn-icon" onClick={() => setRenaming(true)} aria-label="Rename this plan">
            <Pencil size={14} />
          </button>
        }
        actions={
          <div className="plan-run-actions">
            <button
              className="btn btn-ghost"
              onClick={() => setConfirmDelete(true)}
              aria-label="Delete this plan"
            >
              <Trash2 size={15} />
            </button>
            <button
              className="btn btn-primary"
              disabled={!startable}
              onClick={() => day && onStart(day.id)}
              title={startable ? undefined : 'Add an exercise first'}
            >
              <Play size={15} /> <span className="plan-start-label">Start</span>
            </button>
          </div>
        }
      />

      <div className="page-content">
        {renaming && (
          <RenameDialog
            initial={name}
            onCancel={() => setRenaming(false)}
            onSave={renamePlan}
          />
        )}

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
              <button className="btn-icon" onClick={removeDay} aria-label={`Remove ${day.name}`}>
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
                    suggestions={suggestions}
                    onMove={by => move(bi, by)}
                    onPatch={(oi, patch) => patchExercise(bi, oi, patch)}
                    onRemove={() => patchDay(d => ({ ...d, blocks: d.blocks.filter((_, i) => i !== bi) }))}
                    onRemoveOption={oi => patchBlock(bi, b => ({
                      ...b,
                      options: b.options.filter((_, i) => i !== oi),
                    }))}
                    onAddOption={() => patchBlock(bi, b => ({ ...b, options: [...b.options, newExercise()] }))}
                  />
                  {/* The break before the next exercise, sitting between the
                      two things it separates rather than inside either. */}
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

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${plan.name}?`}
          message="The plan and its days go. Sessions you have already run stay in your history, with the exercises as they were on the day."
          confirmLabel="Delete"
          danger
          busy={busy}
          onConfirm={deletePlan}
          onCancel={() => setConfirmDelete(false)}
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

/** Renaming the plan, opened from the pencil beside the title. */
function RenameDialog({ initial, onSave, onCancel }: {
  initial: string
  onSave: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <form
      className="card plan-rename"
      onSubmit={e => { e.preventDefault(); onSave(value) }}
    >
      <label className="field-label" htmlFor="plan-rename">Plan name</label>
      <div className="plan-rename-row">
        <input
          id="plan-rename"
          className="input"
          value={value}
          autoFocus
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onCancel() } }}
        />
        <button type="submit" className="btn btn-primary"><Check size={15} /> Save</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

/**
 * The break between one exercise and the next.
 *
 * Separate from the rest between sets, which lives on the exercise: ninety
 * seconds between sets of the same lift and three minutes before moving to
 * another station are different waits, and one field could only be right about
 * one of them. Nothing is shown after the last exercise — there is no next one
 * to rest before.
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
      <button className="plan-break-add" onClick={() => setEditing(true)}>
        <Timer size={13} /> Add a break
      </button>
    )
  }
  return (
    <div className="plan-break">
      <Timer size={13} aria-hidden />
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
      <span>seconds break</span>
      {seconds > 0 && (
        <button
          className="btn-icon"
          onClick={() => { onChange(0); setEditing(false) }}
          aria-label="Remove this break"
        >
          <X size={13} />
        </button>
      )}
    </div>
  )
}

interface BlockProps {
  block: PlanBlock
  first: boolean
  last: boolean
  suggestions: string[]
  onMove: (by: number) => void
  onPatch: (optionIndex: number, patch: Partial<PlanExercise>) => void
  onRemove: () => void
  onRemoveOption: (optionIndex: number) => void
  onAddOption: () => void
}

/**
 * One slot in the day.
 *
 * A single exercise is a plain row. Adding an alternative turns it into a
 * bordered "choose one" group in place — the only genuinely new concept in the
 * feature, so it is the one thing here given its own colour.
 */
function BlockEditor({ block, first, last, suggestions, onMove, onPatch, onRemove, onRemoveOption, onAddOption }: BlockProps) {
  const group = block.options.length > 1

  return (
    <div className={group ? 'plan-group' : 'plan-edit-block'}>
      {group && (
        <div className="plan-group-head">
          <span className="field-label">Choose one</span>
          <button className="btn-icon" onClick={onRemove} aria-label="Remove this exercise">
            <X size={14} />
          </button>
        </div>
      )}

      {block.options.map((ex, oi) => (
        <div className="plan-erow" key={ex.id || oi}>
          {!group && (
            <span className="plan-grip">
              {/* Reorder is two buttons rather than a drag: dragging inside a
                  vertically scrolling page on a touch screen fights the
                  scroll, and this is unambiguous with one thumb. */}
              <button className="btn-icon" disabled={first} onClick={() => onMove(-1)} aria-label="Move up">↑</button>
              <button className="btn-icon" disabled={last} onClick={() => onMove(1)} aria-label="Move down">↓</button>
              <GripVertical size={14} aria-hidden />
            </span>
          )}
          <ExerciseNameInput
            className="input plan-ename"
            value={ex.name}
            suggestions={suggestions}
            onChange={v => onPatch(oi, { name: v })}
          />
          <div className="plan-efields">
            <label>
              <span className="field-label">Sets</span>
              <input
                className="input" type="number" inputMode="numeric" min="1" max="50"
                value={ex.sets}
                onChange={e => onPatch(oi, { sets: Math.max(1, parseInt(e.target.value, 10) || 1) })}
              />
            </label>
            <label>
              <span className="field-label">Reps</span>
              {/* Text, not a number: "8-10" and "45 s" are both real answers. */}
              <input
                className="input" value={ex.reps} placeholder="8"
                onChange={e => onPatch(oi, { reps: e.target.value })}
              />
            </label>
            <label>
              <span className="field-label">kg</span>
              <input
                className="input" type="number" inputMode="decimal" step="0.5" min="0"
                value={ex.weightKg || ''}
                placeholder="—"
                onChange={e => onPatch(oi, { weightKg: parseFloat(e.target.value) || 0 })}
              />
            </label>
            <label>
              <span className="field-label">Rest</span>
              {/* Between sets of this exercise, as opposed to the break
                  between exercises below the card. */}
              <input
                className="input" type="number" inputMode="numeric" min="0" step="15"
                value={ex.restSec || ''}
                placeholder="—"
                aria-label="Rest between sets, in seconds"
                onChange={e => onPatch(oi, { restSec: Math.max(0, parseInt(e.target.value, 10) || 0) })}
              />
            </label>
          </div>
          <button
            className="btn-icon plan-erow-x"
            onClick={() => (group ? onRemoveOption(oi) : onRemove())}
            aria-label={`Remove ${ex.name || 'this exercise'}`}
          >
            <X size={15} />
          </button>
        </div>
      ))}

      <button className="plan-add-alt" onClick={onAddOption}>
        <Plus size={13} /> {group ? 'Add an option' : 'Add an alternative'}
      </button>
    </div>
  )
}
