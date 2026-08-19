import { useEffect, useState } from 'react'
import { MessageSquare, NotebookPen, Pencil } from 'lucide-react'
import { ApiError, type ShareKind } from '../lib/api'
import WorkoutSocial from './WorkoutSocial'

/**
 * The note on a plan or a session, and the conversation about it.
 *
 * Two things below the content of the page rather than behind tabs, which is
 * where the workout page puts the same pair. A plan already spends its tab
 * strip on days and a session has no tabs at all, so a second strip would have
 * meant two rows of tabs meaning different things — and both of these are
 * short enough to read at the bottom of what they are about.
 *
 * They are deliberately not the same kind of thing, and are drawn apart:
 *
 *   the note is yours, private, and the server redacts it from everyone else
 *   — it is what you thought, not what you said;
 *
 *   the conversation is the opposite, and only exists once the thing is
 *   shared with somebody.
 *
 * Putting them in one card would have implied the note was part of what other
 * people can read, which is the one misunderstanding worth designing against.
 */
export default function NotesAndSocial({
  kind, id, isOwner, notes, onSaveNotes, placeholder,
}: {
  kind: ShareKind
  id: string
  isOwner: boolean
  /** The current note; empty when there is none, absent when redacted. */
  notes?: string
  /** Saves an edited note. Absent means the note is read-only here. */
  onSaveNotes?: (notes: string) => Promise<void>
  placeholder: string
}) {
  const noun = kind === 'plan' ? 'plan' : kind === 'session' ? 'session' : 'workout'

  return (
    <>
      {/* Owner-only, because the server clears the note for everyone else —
          offering the section to a viewer would be a heading over a blank
          that can never fill in. */}
      {isOwner && (
        <NotesCard notes={notes ?? ''} onSave={onSaveNotes} placeholder={placeholder} />
      )}

      <section className="plan-panel">
        <h3 className="plan-panel-title">
          <MessageSquare size={14} aria-hidden /> Discussion
        </h3>
        <WorkoutSocial kind={kind} workoutId={id} isOwner={isOwner} noun={noun} />
      </section>
    </>
  )
}

/**
 * The note, read until you click into it.
 *
 * An edit mode rather than a permanently live textarea: this sits at the
 * bottom of a page that is mostly read, and a focused input there invites a
 * stray tap into a save nobody meant.
 */
function NotesCard({ notes, onSave, placeholder }: {
  notes: string
  onSave?: (notes: string) => Promise<void>
  placeholder: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(notes)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // A note changed elsewhere — finishing a session writes one — should not be
  // shadowed by a stale draft from a previous mount.
  useEffect(() => { if (!editing) setDraft(notes) }, [notes, editing])

  async function save() {
    if (!onSave) return
    setBusy(true)
    setError('')
    try {
      await onSave(draft.trim())
      setEditing(false)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save that.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="plan-panel">
      <h3 className="plan-panel-title">
        <NotebookPen size={14} aria-hidden /> Notes
        {onSave && !editing && (
          <button
            className="btn-icon plan-panel-action"
            onClick={() => setEditing(true)}
            aria-label={notes ? 'Edit notes' : 'Add notes'}
            title={notes ? 'Edit notes' : 'Add notes'}
          >
            <Pencil size={14} />
          </button>
        )}
      </h3>

      {editing ? (
        <>
          <textarea
            className="input"
            rows={4}
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder={placeholder}
          />
          {error && <span className="status-msg err">{error}</span>}
          <div className="plan-panel-buttons">
            <button className="btn btn-ghost" disabled={busy} onClick={() => { setDraft(notes); setEditing(false) }}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </>
      ) : notes ? (
        // Whitespace preserved: a note is usually a list, and collapsing the
        // line breaks turns one into a paragraph nobody wrote.
        <p className="plan-panel-notes">{notes}</p>
      ) : (
        <p className="social-empty">{placeholder}</p>
      )}
    </section>
  )
}
