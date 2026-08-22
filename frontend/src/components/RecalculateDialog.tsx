import { RotateCcw, X } from 'lucide-react'
import { type RecalcParts } from '../data/workouts'
import Modal from './Modal'

/**
 * Which values a recalculation replaces.
 *
 * A list rather than a warning, because the warning was the whole interface:
 * "any values you entered manually will be overwritten" told the user what they
 * were about to lose without offering any way to keep it. Wanting the pauses
 * found on an old workout is the common case, and it used to cost a corrected
 * calorie count.
 *
 * Every box is ticked when it opens. That is what the button did before, so
 * nothing changes for someone who does not look.
 */

interface Part {
  key: keyof RecalcParts
  label: string
  hint: string
}

const PARTS: Part[] = [
  {
    key: 'pauses',
    label: 'Pauses and moving time',
    hint: 'Finds the stretches where the recording stopped. Workouts imported before this existed have none until you do this.',
  },
  {
    key: 'paceSpeed',
    label: 'Average pace and speed',
    hint: 'Recomputed from the distance and the moving time.',
  },
  {
    key: 'heartRate',
    label: 'Average and max heart rate',
    hint: 'Recomputed from the recorded samples.',
  },
  {
    key: 'elevation',
    label: 'Elevation gain',
    hint: 'Re-added from the recorded altitude series.',
  },
  {
    key: 'steps',
    label: 'Steps',
    hint: 'From the recorded cadence where there is any, and from your stride length otherwise. Replaces a figure you entered by hand.',
  },
  {
    key: 'calories',
    label: 'Calories',
    hint: 'Re-estimated from your body settings. Replaces both a figure you entered and one the file reported.',
  },
]

export default function RecalculateDialog({ parts, onChange, busy, error, onClose, onConfirm }: {
  parts: RecalcParts
  onChange: (next: RecalcParts) => void
  busy: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => void
}) {
  const chosen = PARTS.filter(p => parts[p.key]).length

  // Portalled to the body, and not merely fixed-positioned. Pages render inside
  // the swipe pager, which is `position: relative; z-index: 1` — a stacking
  // context — so a dialog left in the page is capped at that level and the top
  // and bottom bars draw over it. A short dialog never reaches them; a tall one
  // does, which is how this surfaced.
  return (
    <Modal onClose={onClose} dismissable={!busy} label="Recalculate workout">
        <div className="modal-box recalc-modal">
          <div className="dialog-head">
            <h3 className="dialog-title"><RotateCcw size={16} /> Recalculate</h3>
            <button className="btn-icon" onClick={onClose} disabled={busy} aria-label="Close"><X size={16} /></button>
          </div>
          <p className="recalc-note">
            Each of these is worked out again from the recorded track and your
            settings, replacing whatever is there now — including anything you
            entered by hand. The name, type, date and conditions are not touched.
          </p>

          <div className="recalc-parts">
            {PARTS.map(p => (
              <label className="recalc-part" key={p.key}>
                <input
                  type="checkbox"
                  checked={parts[p.key] ?? false}
                  disabled={busy}
                  onChange={e => onChange({ ...parts, [p.key]: e.target.checked })}
                />
                <span className="recalc-part-text">
                  <span className="recalc-part-label">{p.label}</span>
                  <span className="recalc-part-hint">{p.hint}</span>
                </span>
              </label>
            ))}
          </div>

          {error && <p className="recalc-error">{error}</p>}

          <div className="recalc-actions">
            <button
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => onChange(chosen === PARTS.length
                ? {}
                : Object.fromEntries(PARTS.map(p => [p.key, true])))}
            >
              {chosen === PARTS.length ? 'Clear all' : 'Select all'}
            </button>
            <span style={{ flex: 1 }} />
            <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
            {/* Nothing selected is a no-op, and offering it as an action would
                be a button that appears to do something and does not. */}
            <button className="btn btn-primary" onClick={onConfirm} disabled={busy || chosen === 0}>
              {busy ? 'Recalculating…' : `Recalculate ${chosen}`}
            </button>
          </div>
        </div>
    </Modal>
  )
}
