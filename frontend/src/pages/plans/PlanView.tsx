import { Fragment, useState } from 'react'
import { ClipboardList, Copy, MoreVertical, Pencil, Play, Share2, Timer, Trash2 } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import MenuButton from '../../components/MenuButton'
import ConfirmDialog from '../../components/ConfirmDialog'
import ShareDialog from '../../components/ShareDialog'
import { useShareState } from '../../lib/useShareState'
import NotesAndSocial from '../../components/NotesAndSocial'
import ShareBadge from '../../components/ShareBadge'
import UserAvatar, { userLabel } from '../../components/UserAvatar'
import { api, ApiError } from '../../lib/api'
import {
  blockLabel, distanceLabel, durationShort, isBareSection, sectionLabel, trimNum,
  type PlanDay, type TrainingPlan,
} from '../../data/plans'

interface Props {
  plan: TrainingPlan
  onBack: () => void
  onEdit: () => void
  onRename: () => void
  onStart: (dayId: string) => void
  onDeleted: () => void
  /** Called once a clone exists, with the new plan — the caller decides
   *  where that lands (its own id, in the viewer's own library). */
  onCloned: (plan: TrainingPlan) => void
  /** Opens the plan's author, when it is not you. */
  onOpenUser?: (id: number) => void
  /** The plan as the server returned it after a note edit. */
  onNotesSaved: (plan: TrainingPlan) => void
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
export default function PlanView({ plan, onBack, onEdit, onRename, onStart, onDeleted, onCloned, onOpenUser, onNotesSaved }: Props) {
  const [active, setActive] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [cloning, setCloning] = useState(false)
  const [cloneError, setCloneError] = useState('')

  // Absent (your own plan, fetched before sharing existed anywhere) reads as
  // true — every call site before this feature only ever saw its own plans.
  const isOwner = plan.isOwner !== false
  // Whether anyone else can see this, and so whether there is a conversation
  // to be had about it. A viewer is proof of it by being here at all.
  const [shared, onShareChange] = useShareState(
    plan.id,
    !isOwner || plan.visibility === 'public' || (plan.sharedWithCount ?? 0) > 0,
  )

  const days = plan.days ?? []
  const day: PlanDay | undefined = days[active]
  // Starting requires owning the plan server-side (StartSession looks it up
  // by owner), so a shared or public plan offers Clone instead — there is
  // nothing "Start" could do here but fail.
  const startable = isOwner && !!day && day.blocks.length > 0

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

  async function clonePlan() {
    setCloning(true)
    setCloneError('')
    try {
      onCloned(await api.clonePlan(plan.id))
    } catch (e) {
      setCloneError(e instanceof ApiError ? e.message : 'Could not clone this plan.')
      setCloning(false)
    }
  }

  return (
    <>
      <PageHeader
        title={plan.name}
        subtitle={`${days.length} day${days.length === 1 ? '' : 's'}`}
        onBack={onBack}
        /* The same shape a workout's header has: what kind of thing this is
           beside its name, whether you have shared it, and whose it is on the
           line under the date. It used to sit at the top of the page body,
           which read as content of the plan rather than as its identity. */
        subtitleAction={
          <>
            <span className="badge tag-plan"><ClipboardList size={12} /> Plan</span>
            {isOwner && <ShareBadge workout={plan} />}
          </>
        }
        meta={!isOwner && plan.owner ? (
          <button
            type="button"
            className="owner-byline owner-byline-link page-header-byline"
            onClick={() => onOpenUser?.(plan.owner!.id)}
            disabled={!onOpenUser}
          >
            <span>Shared by</span>
            <UserAvatar user={plan.owner} size={20} />
            <span>{userLabel(plan.owner)}</span>
          </button>
        ) : undefined}
        /* Kept on the title's row: a lone icon button dropped below it sat
           under the back arrow, reading as part of the navigation rather than
           as the plan's own menu. */
        compactActions
        /* One menu rather than three buttons: a rename, an edit and a delete
           beside a long plan name wrapped the header onto a third row on a
           phone, and only one of the four is worth a permanent button. */
        /* Someone else's plan has exactly one thing you can do to it, so it
           gets one button and no menu. A kebab holding a single item is a
           menu that exists to be opened once and then agreed with. */
        actions={isOwner ? (
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
              <button className="options-menu-item" onClick={() => setSharing(true)}>
                <Share2 size={14} /> Share
              </button>
              <button className="options-menu-item danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={14} /> Delete plan
              </button>
            </MenuButton>
          </div>
        ) : (
          /* Not desktop-only, and no FAB below: with the menu gone this is the
             only way to act on the plan, so it has to be on screen at every
             width rather than duplicated into a floating button. */
          <button className="btn btn-primary" disabled={cloning} onClick={() => void clonePlan()}>
            <Copy size={15} /> {cloning ? 'Cloning…' : 'Clone'}
          </button>
        )}
      />

      <div className={`page-content${startable ? ' with-fab' : ''}`}>
        {cloneError && <div className="status-msg err" role="alert">{cloneError}</div>}
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
                  {(block.section || block.options.length > 1) && (
                    <span className="field-label plan-read-kind">
                      {block.section ? sectionLabel(block.section) : blockLabel(block)}
                    </span>
                  )}
                  {/* A section with nothing in it is a length of time. */}
                  {isBareSection(block) && (
                    <div className="plan-read-ex">
                      <span className="plan-read-name">{durationShort(block.durationSec)}</span>
                    </div>
                  )}
                  {block.options.map((ex, oi) => (
                    <Fragment key={ex.id}>
                      {/* The name on its own line, the numbers under it with
                          labels — the same shape the expanded runner uses, and
                          the reason that view reads so much better than a row
                          of bare figures did. */}
                      <div className="plan-read-ex">
                        <span className="plan-read-name">{ex.name}</span>
                        <div className="plan-read-stats">
                          <Stat label="Sets" value={String(ex.sets)} />
                          {ex.kind === 'time'
                            ? <Stat label="Duration" value={durationShort(ex.durationSec)} />
                            : ex.kind === 'distance'
                              ? <Stat label="Distance" value={distanceLabel(ex)} />
                              : <Stat label="Reps" value={ex.reps || '—'} />}
                          {(ex.kind !== 'time' || ex.weightKg > 0) && (
                            <Stat
                              label={ex.kind === 'weight' ? 'Weight' : 'Added'}
                              value={ex.weightKg > 0 ? `${trimNum(ex.weightKg)} kg` : ex.kind === 'body' ? 'body' : '—'}
                            />
                          )}
                          {ex.restSec > 0 && <Stat label="Rest" value={durationShort(ex.restSec)} />}
                        </div>
                      </div>
                      {/* The wait between one movement of a superset and the
                          next, on the rule that separates them. */}
                      {ex.breakSec > 0 && oi < block.options.length - 1 && (
                        <div className="plan-break-line">
                          <span className="plan-break-chip">
                            <Timer size={12} aria-hidden /> {durationShort(ex.breakSec)} in between
                          </span>
                        </div>
                      )}
                    </Fragment>
                  ))}
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

        <NotesAndSocial
          kind="plan"
          id={plan.id}
          isOwner={isOwner}
          shared={shared}
          notes={plan.notes}
          onSaveNotes={async notes => { onNotesSaved(await api.patchPlan(plan.id, { notes })) }}
          placeholder="Anything about this plan — where the weights came from, what to progress next."
        />
      </div>

      {/* The phone's start control, where the thumb is. Only for your own
          plan: someone else's carries its single Clone button in the header
          instead, so a FAB here would be the same action twice. */}
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

      {sharing && (
        <ShareDialog
          kind="plan"
          id={plan.id}
          noun="plan"
          subject={{
            icon: <ClipboardList size={16} />,
            name: plan.name,
            meta: `${days.length} day${days.length === 1 ? '' : 's'}`,
          }}
          onClose={() => setSharing(false)}
          /* So the Social tab appears the moment this is shared — see
             useShareState. */
          onChange={onShareChange}
        />
      )}
    </>
  )
}

/** One labelled figure, the same shape the runner's expanded view uses. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-chip">
      <span className="label">{label}</span>
      <span className="value plan-num">{value}</span>
    </div>
  )
}
