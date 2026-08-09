import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Copy, X } from 'lucide-react'
import { fmtDist, fmtDuration, type Workout } from '../data/workouts'
import { findDuplicateGroups, redundantIds } from '../lib/duplicates'
import useDismissOnBack from '../lib/useDismissOnBack'
import TypeIcon from './TypeIcon'
import SourceMark from './SourceMark'
import InfoTip from './InfoTip'

const HOW_IT_WORKS = 'Workouts of the same sport on the same day are treated as '
  + 'the same activity when their duration and distance agree to within a couple '
  + 'of percent, and — where both files recorded one — their start times are '
  + 'within half an hour. The first in each group is the earliest import and is '
  + 'the one to keep. Check each group before removing anything: an interval '
  + 'session repeated on a track is a real pair of workouts, and this cannot tell '
  + 'that apart from a mistake.'

/**
 * Suspected duplicate imports, and a way to act on them.
 *
 * The action deliberately does not delete: it ticks the copies in the list
 * behind this dialog and closes, dropping the user into the selection toolbar
 * they already know, where Delete lives behind the confirmation it already has.
 * A second delete path here would be a second place to get a destructive
 * operation wrong, on the output of a heuristic that can be mistaken.
 */
export default function DuplicatesDialog({ workouts, onClose, onSelect }: {
  workouts: Workout[]
  onClose: () => void
  /** Hands the ids of every copy-to-remove back to the list. */
  onSelect: (ids: string[]) => void
}) {
  useDismissOnBack(true, onClose)
  const groups = useMemo(() => findDuplicateGroups(workouts), [workouts])
  const extra = useMemo(() => redundantIds(groups), [groups])

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
                activity imported more than once. Check each before removing anything.
              </p>

              <div className="dup-groups">
                {groups.map(group => (
                  <div className="dup-group" key={group[0].id}>
                    {group.map((w, i) => (
                      <div className={`dup-row${i === 0 ? ' keep' : ''}`} key={w.id}>
                        <TypeIcon type={w.type} size={16} />
                        <div className="dup-row-main">
                          {/* The name and the tag share the top line, so on a
                              phone the tag cannot be pushed off the end by a
                              long device-generated name. */}
                          <span className="dup-row-top">
                            <span className="dup-row-name">{w.name}</span>
                            <span className="dup-row-tag">{i === 0 ? 'Keep' : 'Copy'}</span>
                          </span>
                          <span className="dup-row-meta">
                            <span>{w.date}</span>
                            <span>{fmtDuration(w.duration)}</span>
                            {w.distance > 0 && <span>{fmtDist(w.distance)}</span>}
                            <SourceMark source={w.source} />
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="dup-actions">
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
            {extra.length > 0 && (
              <button className="btn btn-primary" onClick={() => onSelect(extra)}>
                Select {extra.length} cop{extra.length === 1 ? 'y' : 'ies'} in the list
              </button>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}
