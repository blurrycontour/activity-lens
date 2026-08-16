import { useCallback, useEffect, useRef, useState } from 'react'
import { GripVertical, Play, Plus, Trash2, X } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import ConfirmDialog from '../../components/ConfirmDialog'
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
  const [save, setSave] = useState<SaveState>('clean')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  const day = days[active]

  // --- autosave ----------------------------------------------------------
  const timer = useRef<number | null>(null)
  const pending = useRef<PlanDay[] | null>(null)

  const flush = useCallback(async () => {
    const next = pending.current
    if (!next) return
    pending.current = null
    setSave('saving')
    try {
      const saved = await api.savePlanDays(plan.id, next)
      // The answer carries the ids the server issued for newly added rows, so
      // the next save updates them instead of creating duplicates. Taking it
      // back wholesale would also throw away anything typed while the request
      // was in flight, so it is only adopted when nothing else is queued.
      if (!pending.current) setDays(saved.days ?? [])
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
    setName(next)
    try {
      const saved = await api.patchPlan(plan.id, { name: next })
      onSaved(saved)
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

  return (
    <>
      <PageHeader
        title={name}
        subtitle={saveLabel(save)}
        onBack={onBack}
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
              disabled={!day || day.blocks.length === 0}
              onClick={() => day && onStart(day.id)}
              title={day && day.blocks.length === 0 ? 'Add an exercise first' : undefined}
            >
              <Play size={15} /> Start {day ? day.name : ''}
            </button>
          </div>
        }
      />

      <div className="page-content">
        <label className="form-label" htmlFor="plan-name">Plan name</label>
        <input
          id="plan-name"
          className="input"
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={e => renamePlan(e.target.value.trim() || plan.name)}
        />

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
                <BlockEditor
                  key={block.id || bi}
                  block={block}
                  first={bi === 0}
                  last={bi === day.blocks.length - 1}
                  onMove={by => move(bi, by)}
                  onPatch={(oi, patch) => patchExercise(bi, oi, patch)}
                  onRemove={() => patchDay(d => ({ ...d, blocks: d.blocks.filter((_, i) => i !== bi) }))}
                  onRemoveOption={oi => patchBlock(bi, b => ({
                    ...b,
                    options: b.options.filter((_, i) => i !== oi),
                  }))}
                  onAddOption={() => patchBlock(bi, b => ({ ...b, options: [...b.options, newExercise()] }))}
                />
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

interface BlockProps {
  block: PlanBlock
  first: boolean
  last: boolean
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
function BlockEditor({ block, first, last, onMove, onPatch, onRemove, onRemoveOption, onAddOption }: BlockProps) {
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
          <input
            className="input plan-ename"
            value={ex.name}
            placeholder="Exercise name"
            aria-label="Exercise name"
            onChange={e => onPatch(oi, { name: e.target.value })}
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
