import { Fragment, useState } from 'react'
import { MoreVertical, Pencil, Play, Timer, Trash2 } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import MenuButton from '../../components/MenuButton'
import ConfirmDialog from '../../components/ConfirmDialog'
import { api } from '../../lib/api'
import {
  blockLabel, durationShort, sectionLabel, targetLabel, type PlanDay, type TrainingPlan,
} from '../../data/plans'

interface Props {
  plan: TrainingPlan
  onBack: () => void
  onEdit: () => void
  onRename: () => void
  onStart: (dayId: string) => void
  onDeleted: () => void
}

/**
 * A plan as it is read: the day you are about to train, laid out to be
 * glanced at rather than typed into.
 *
 * Opening straight into the editor made every visit an editing session — every
 * exercise a text field, every number a spinner, and the thing you actually
 * came for (what am I doing today, and start it) buried among controls for
 * changing it. Editing is now a mode you ask for.
 */
export default function PlanView({ plan, onBack, onEdit, onRename, onStart, onDeleted }: Props) {
  const [active, setActive] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  const days = plan.days ?? []
  const day: PlanDay | undefined = days[active]
  const startable = !!day && day.blocks.length > 0

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
        title={plan.name}
        subtitle={`${days.length} day${days.length === 1 ? '' : 's'}`}
        onBack={onBack}
        /* Kept on the title's row: a lone icon button dropped below it sat
           under the back arrow, reading as part of the navigation rather than
           as the plan's own menu. */
        compactActions
        /* One menu rather than three buttons: a rename, an edit and a delete
           beside a long plan name wrapped the header onto a third row on a
           phone, and only one of the four is worth a permanent button. */
        actions={
          <div className="plan-run-actions">
            <button
              className="btn btn-primary desktop-only"
              disabled={!startable}
              onClick={() => day && onStart(day.id)}
              title={startable ? undefined : 'Add an exercise first'}
            >
              <Play size={15} /> Start
            </button>
            <MenuButton icon={<MoreVertical size={16} />} label="Plan options">
              <button className="options-menu-item" onClick={onEdit}>
                <Pencil size={14} /> Edit plan
              </button>
              <button className="options-menu-item" onClick={onRename}>
                <Pencil size={14} /> Rename
              </button>
              <button className="options-menu-item danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={14} /> Delete plan
              </button>
            </MenuButton>
          </div>
        }
      />

      <div className="page-content">
        {days.length > 1 && (
          <div className="plan-tabs" role="tablist" aria-label="Days">
            {days.map((d, i) => (
              <button
                key={d.id}
                role="tab"
                aria-selected={i === active}
                className={`plan-tab${i === active ? ' active' : ''}`}
                onClick={() => setActive(i)}
              >
                {d.name}
              </button>
            ))}
          </div>
        )}

        {!day ? (
          <div className="empty-state">
            <p>This plan has no days yet.</p>
            <button className="btn btn-primary" onClick={onEdit}>
              <Pencil size={15} /> Edit plan
            </button>
          </div>
        ) : day.blocks.length === 0 ? (
          <div className="empty-state">
            <p>{day.name} has no exercises yet.</p>
            <button className="btn btn-primary" onClick={onEdit}>
              <Pencil size={15} /> Add some
            </button>
          </div>
        ) : (
          <div className="plan-rows">
            {day.blocks.map((block, i) => (
              <Fragment key={block.id}>
                {/* A block holding more than one exercise is drawn as a block:
                    a strength-coloured frame with the phrase that says what it
                    asks for. Rendered flat, a superset and three unrelated
                    exercises were the same three rows. */}
                <div className={`plan-ex plan-ex-read${block.section ? ' plan-ex-section' : block.options.length > 1 ? ' plan-ex-grouped' : ''}`}>
                  <div className="plan-ex-top">
                    <span className="plan-ex-index">{i + 1}</span>
                    <div className="plan-read-body">
                      {(block.section || block.options.length > 1) && (
                        <span className="field-label plan-read-kind">
                          {block.section ? sectionLabel(block.section) : blockLabel(block)}
                        </span>
                      )}
                      {block.options.map(ex => (
                        <div className="plan-read-row" key={ex.id}>
                          <span className="plan-read-name">{ex.name}</span>
                          <span className="plan-read-target plan-num">{targetLabel(ex)}</span>
                        </div>
                      ))}
                      {block.options.some(o => o.restSec > 0) && (
                        <span className="plan-read-rest plan-num">
                          <Timer size={11} aria-hidden />
                          {durationShort(block.options[0].restSec)} between sets
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {/* On the rule between the two cards, which is where the gap it
                    describes actually is. Floating loose under the card it read
                    as a property of that exercise. */}
                {block.restSec > 0 && i < day.blocks.length - 1 && (
                  <div className="plan-break-line">
                    <span className="plan-break-chip">
                      <Timer size={12} aria-hidden /> {durationShort(block.restSec)} break
                    </span>
                  </div>
                )}
              </Fragment>
            ))}
          </div>
        )}
      </div>

      {/* The phone's start control, where the thumb is. */}
      {startable && (
        <button
          className="fab"
          onClick={() => day && onStart(day.id)}
          title={`Start ${day?.name ?? ''}`}
          aria-label={`Start ${day?.name ?? ''}`}
        >
          <Play size={22} />
        </button>
      )}

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
