import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Copy, X } from 'lucide-react'
import { fmtDist, fmtDuration, type Workout } from '../data/workouts'
import { findDuplicateGroups, redundantIds } from '../lib/duplicates'
import useDismissOnBack from '../lib/useDismissOnBack'
import TypeIcon from './TypeIcon'
import SourceMark from './SourceMark'
import InfoTip from './InfoTip'
import ConfirmDialog from './ConfirmDialog'

const HOW_IT_WORKS = 'Workouts of the same sport on the same day are treated as '
  + 'the same activity when their duration and distance agree to within a couple '
  + 'of percent, and — where both files recorded one — their start times are '
  + 'within half an hour. The first in each group is the earliest import and is '
  + 'the one to keep. Check each group before removing anything: an interval '
  + 'session repeated on a track is a real pair of workouts, and this cannot tell '
  + 'that apart from a mistake. Nothing is decided for you: untick a copy to '
  + 'keep it, tick the earliest one to remove that instead, or leave a whole '
  + 'group untouched.'

/**
 * Suspected duplicate imports, and a way to act on them.
 *
 * The action deliberately does not delete: it ticks the chosen copies in the
 * list behind this dialog and closes, dropping the user into the selection
 * toolbar they already know, where Delete lives behind the confirmation it
 * already has. A second delete path here would be a second place to get a
 * destructive operation wrong, on the output of a heuristic that can be
 * mistaken.
 *
 * Which copy goes is the user's to decide, per workout. The earliest import in
 * each group is proposed as the one to keep — it has been in the library
 * longest and any share link already points at it — but that is a starting
 * position and every row is free: keep the later copy instead, keep both, or
 * leave the group alone entirely. The two files often differ in ways only the
 * person who recorded them can weigh, and the guess that reads as a decision is
 * the one that quietly loses the better copy.
 */
export default function DuplicatesDialog({ workouts, onClose, onSelect }: {
  workouts: Workout[]
  onClose: () => void
  /** Hands the ids of every copy-to-remove back to the list. */
  onSelect: (ids: string[]) => void
}) {
  const [confirming, setConfirming] = useState(false)
  // Back closes the confirmation first, then the dialog behind it — one step
  // per surface, which is what the gesture means everywhere else in the app.
  useDismissOnBack(true, () => (confirming ? setConfirming(false) : onClose()))
  const groups = useMemo(() => findDuplicateGroups(workouts), [workouts])

  /*
   * The rows marked for removal, seeded with everything but the earliest import
   * of each group. Held as a set of ids rather than a per-group index so a
   * group with three copies can lose two, or none.
   */
  const [marked, setMarked] = useState<Set<string>>(() => new Set(redundantIds(groups)))
  const toggle = (id: string) => setMarked(prev => {
    const next = new Set(prev)
    if (!next.delete(id)) next.add(id)
    return next
  })

  const chosen = useMemo(() => [...marked], [marked])
  // A group with every copy marked would take the activity out of the library
  // altogether. Allowed — it is a selection, not a deletion, and someone may
  // genuinely want it gone — but never silently.
  const wholeGroups = useMemo(
    () => groups.filter(g => g.every(w => marked.has(w.id))).length,
    [groups, marked],
  )

  // Portalled to the body, and not merely fixed-positioned. Pages render inside
  // the swipe pager, which is `position: relative; z-index: 1` — a stacking
  // context — so a dialog left in the page is capped at that level and the top
  // and bottom bars draw over it. A short dialog never reaches them; a tall one
  // does, which is how this surfaced.
  return createPortal(
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal">
        <div className="modal-box dup-modal" role="dialog" aria-modal="true" aria-label="Possible duplicates">
          <div className="dup-head">
            <h3 style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Copy size={15} /> Possible duplicates
              {/* The caveats matter and are too long to leave in front of the
                  list they are about — a paragraph above a scrolling panel eats
                  the room the panel needs, and is read once and never again. */}
              <InfoTip label="Possible duplicates" text={HOW_IT_WORKS} />
            </h3>
            <button className="btn-icon" onClick={onClose} aria-label="Close"><X size={16} /></button>
          </div>

          {groups.length === 0 ? (
            <p className="dup-note">Nothing here looks imported twice.</p>
          ) : (
            <>
              <p className="dup-note">
                {groups.length} group{groups.length === 1 ? '' : 's'} look like the same
                activity imported more than once. Tick whichever copies to remove.
              </p>

              <div className="dup-groups">
                {groups.map(group => {
                  const all = group.every(w => marked.has(w.id))
                  return (
                    <div className="dup-group" key={group[0].id}>
                      {group.map(w => {
                        const remove = marked.has(w.id)
                        return (
                          <label className={`dup-row${remove ? ' remove' : ' keep'}`} key={w.id}>
                            <input
                              type="checkbox"
                              checked={remove}
                              onChange={() => toggle(w.id)}
                              aria-label={`Remove ${w.name}`}
                            />
                            <TypeIcon type={w.type} size={16} />
                            <div className="dup-row-main">
                              {/* The name and the tag share the top line, so on
                                  a phone the tag cannot be pushed off the end by
                                  a long device-generated name. */}
                              <span className="dup-row-top">
                                <span className="dup-row-name">{w.name}</span>
                                <span className="dup-row-tag">{remove ? 'Remove' : 'Keep'}</span>
                              </span>
                              <span className="dup-row-meta">
                                <span>{w.date}</span>
                                <span>{fmtDuration(w.duration)}</span>
                                {w.distance > 0 && <span>{fmtDist(w.distance)}</span>}
                                <SourceMark source={w.source} />
                              </span>
                            </div>
                          </label>
                        )
                      })}
                      {all && (
                        <p className="dup-group-warn">
                          <AlertTriangle size={12} />
                          Every copy is ticked — this activity would leave your library.
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}

          <div className="dup-actions">
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
            <button
              className="btn btn-primary"
              disabled={chosen.length === 0}
              onClick={() => setConfirming(true)}
            >
              {chosen.length === 0
                ? 'Nothing ticked'
                : `Select ${chosen.length} in the list`}
            </button>
          </div>
        </div>
      </div>
      {/* Inside this portal and after the dialog, so it paints on top of it:
          the two share a z-index, and a ConfirmDialog rendered from the page
          instead would be trapped under the swipe pager's stacking context. */}
      {confirming && (
        <ConfirmDialog
          title={`Select ${chosen.length} workout${chosen.length === 1 ? '' : 's'}?`}
          danger={wholeGroups > 0}
          message={
            <>
              This ticks them in your workout list so you can look through them
              and delete the ones you want. <strong>Nothing is deleted here.</strong>
              {wholeGroups > 0 && (
                <>
                  {' '}In {wholeGroups === 1 ? 'one group' : `${wholeGroups} groups`} you
                  have ticked every copy, so that activity would leave your library
                  entirely.
                </>
              )}
            </>
          }
          confirmLabel="Select them"
          onConfirm={() => onSelect(chosen)}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>,
    document.body,
  )
}
