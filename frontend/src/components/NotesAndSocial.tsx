import { useCallback, useEffect, useRef, useState } from 'react'
import { LOCATION_EVENT } from '../App'
import { clearDeepLink, deepLinkFor } from '../lib/deepLink'
import { Lock, MessageSquare, NotebookPen } from 'lucide-react'
import { ApiError, type ShareKind } from '../lib/api'
import TabStrip, { type TabStripItem } from './TabStrip'
import WorkoutSocial from './WorkoutSocial'

type SectionTab = 'notes' | 'social'

/**
 * The note on a plan or a session, and the conversation about it.
 *
 * The same strip-and-panel a workout uses for exactly the same pair, so the
 * three kinds of thing read as one app rather than three. It sits last on the
 * page, after the content it is about, which is where the workout page puts it
 * too.
 *
 * The two are deliberately not offered together:
 *
 *   the note is yours, private, and the server redacts it from everyone else
 *   — so a viewer is never shown a tab that can only ever be empty;
 *
 *   the conversation only exists once the thing is shared with somebody, for
 *   the same reason a private workout has no Social tab: a thread that refuses
 *   every comment is worse than no thread.
 */
export default function NotesAndSocial({
  kind, id, isOwner, shared, notes, onSaveNotes, placeholder,
}: {
  kind: ShareKind
  id: string
  isOwner: boolean
  /** Whether anyone else can see this — see the Social tab's comment. */
  shared: boolean
  /** The current note; empty when there is none, absent when redacted. */
  notes?: string
  /** Saves an edited note. Absent means the note is read-only here. */
  onSaveNotes?: (notes: string) => Promise<void>
  placeholder: string
}) {
  const noun = kind === 'plan' ? 'plan' : kind === 'session' ? 'session' : 'workout'

  const tabs: TabStripItem<SectionTab>[] = [
    ...(isOwner ? [{ id: 'notes' as SectionTab, label: 'Notes', icon: <NotebookPen size={14} /> }] : []),
    ...(shared ? [{ id: 'social' as SectionTab, label: 'Social', icon: <MessageSquare size={14} /> }] : []),
  ]

  const [tab, setTab] = useState<SectionTab>(() => deepLinkFor(id).tab === 'social' ? 'social' : 'notes')
  // A viewer has no Notes tab, and an unshared plan has no Social one, so the
  // remembered choice can be a tab this item does not offer.
  const active = tabs.some(t => t.id === tab) ? tab : tabs[0]?.id
  /*
   * The comment a notification pointed at, until the panel has found it.
   * Same contract as the workout page's — see WorkoutDetail.
   */
  const [focusComment, setFocusComment] = useState<string | null>(() => deepLinkFor(id).commentId)
  const onFocused = useCallback(() => setFocusComment(null), [])
  const wrap = useRef<HTMLDivElement>(null)

  /*
   * Follows a notification's deep link, exactly as the workout page does.
   *
   * Plans and sessions carry the same conversations and the same
   * notifications, so they need the same three things: a tab read from the URL
   * rather than assumed, a re-read whenever the URL changes without a remount
   * (which is what tapping a notification for the page you are already on
   * does), and a scroll past the content to the thread.
   *
   * Scoped to this id. Every mounted detail page hears this event, and a page
   * that reads a link meant for another one also clears it — see deepLinkFor.
   */
  useEffect(() => {
    function follow() {
      const { tab: asked, commentId } = deepLinkFor(id)
      if (!asked && !commentId) return
      if (asked === 'social') setTab('social')
      setFocusComment(commentId)
      clearDeepLink()
      // The Social panel scrolls itself to a named comment; this is for the
      // case with none to find — a deleted one — and for getting the reader
      // past the content while the thread loads.
      if (!commentId) wrap.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
    follow()
    window.addEventListener(LOCATION_EVENT, follow)
    window.addEventListener('popstate', follow)
    return () => {
      window.removeEventListener(LOCATION_EVENT, follow)
      window.removeEventListener('popstate', follow)
    }
  }, [id])

  if (!active) return null

  return (
    <div className="detail-sections" ref={wrap}>
      <TabStrip items={tabs} value={active} onChange={setTab} ariaLabel={`${noun.charAt(0).toUpperCase()}${noun.slice(1)} sections`} fill />
      <div className="card detail-tab-panel">
        {active === 'notes' && (
          <NotesPanel notes={notes ?? ''} onSave={onSaveNotes} placeholder={placeholder} />
        )}
        {active === 'social' && (
          <WorkoutSocial
            kind={kind}
            workoutId={id}
            isOwner={isOwner}
            noun={noun}
            focusCommentId={focusComment}
            onFocused={onFocused}
          />
        )}
      </div>
    </div>
  )
}

/**
 * The note, read until you click into it.
 *
 * An edit mode rather than a permanently live textarea, matching the workout's
 * notes panel: this is mostly read, and a focused input invites a stray tap
 * into a save nobody meant.
 */
function NotesPanel({ notes, onSave, placeholder }: {
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
    <div>
      <div className="plan-notes-head">
        <span className="notes-private" title="Notes stay private — they are never included when this is shared or made public">
          <Lock size={10} /> Private
        </span>
        {onSave && !editing && (
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setEditing(true)}>
            {notes ? 'Edit' : 'Add note'}
          </button>
        )}
      </div>

      {editing ? (
        <>
          <textarea
            className="notes-input"
            rows={5}
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder={placeholder}
            disabled={busy}
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
    </div>
  )
}
