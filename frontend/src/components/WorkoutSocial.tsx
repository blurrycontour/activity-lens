import { useCallback, useEffect, useRef, useState } from 'react'
import { LoaderCircle, MessageSquare, Pencil, SmilePlus, Trash2 } from 'lucide-react'
import ConfirmDialog from './ConfirmDialog'
import UserAvatar, { userLabel } from './UserAvatar'
import { useAuth } from '../context/AuthContext'
import { api, ApiError, type WorkoutComment, type WorkoutSocial as Social } from '../lib/api'

/**
 * Reactions and comments on a shared workout.
 *
 * Mounted only when its tab is opened — see WorkoutDetail's lazy import — so a
 * workout nobody has commented on costs no request until someone looks.
 *
 * Reactions sit above the thread because they are the cheap gesture: most
 * visits leave one and nothing else, and putting them behind a scroll past the
 * comments would be putting the common case last.
 *
 * The tab is only offered on a shared workout, but this still handles the
 * unshared answer: sharing can be turned off in another tab while this page is
 * open, and "nobody has said anything" and "this is private" are different
 * things to say.
 */

interface WorkoutSocialProps {
  workoutId: string
  /** Owners may remove any comment; everyone may remove their own. */
  isOwner: boolean
}

export default function WorkoutSocial({ workoutId, isOwner }: WorkoutSocialProps) {
  const { user } = useAuth()
  const [social, setSocial] = useState<Social | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<WorkoutComment | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    try {
      setSocial(await api.workoutSocial(workoutId))
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load comments.')
    }
  }, [workoutId])

  useEffect(() => { void load() }, [load])

  async function react(emoji: string) {
    if (!social) return
    // Tapping the one already chosen clears it; the server reads an empty
    // string as "remove mine", so the toggle is one request either way.
    const next = social.myReaction === emoji ? '' : emoji
    try {
      setSocial(await api.setWorkoutReaction(workoutId, next))
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that reaction.')
    }
  }

  async function post() {
    const body = draft.trim()
    if (!body || posting) return
    setPosting(true)
    try {
      const c = await api.addComment(workoutId, body)
      setSocial(prev => (prev ? { ...prev, comments: [...prev.comments, c] } : prev))
      setDraft('')
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not post that comment.')
    } finally {
      setPosting(false)
    }
  }

  async function saveEdit() {
    if (!editing) return
    const body = editing.body.trim()
    if (!body) return
    try {
      const c = await api.editComment(workoutId, editing.id, body)
      setSocial(prev => (prev
        ? { ...prev, comments: prev.comments.map(x => (x.id === c.id ? c : x)) }
        : prev))
      setEditing(null)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that edit.')
    }
  }

  async function remove(comment: WorkoutComment) {
    setDeleting(true)
    try {
      await api.deleteComment(workoutId, comment.id)
      setSocial(prev => (prev
        ? { ...prev, comments: prev.comments.filter(x => x.id !== comment.id) }
        : prev))
      setConfirmDelete(null)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete that comment.')
    } finally {
      setDeleting(false)
    }
  }

  if (!social) {
    return <div className="social-empty"><LoaderCircle size={18} className="spin" /></div>
  }

  if (!social.shared) {
    return (
      <p className="social-empty">
        Share this workout to open it for comments and reactions.
      </p>
    )
  }

  // Grouped by emoji so the bar shows six buckets at most, whoever reacted.
  const counts = social.emojis
    .map(e => ({
      emoji: e,
      people: social.reactions.filter(r => r.emoji === e),
    }))
    .filter(g => g.people.length > 0)

  return (
    <div className="social">
      <div className="social-reactions">
        {/* The picker is the whole set, always visible: six emoji is small
            enough to show outright, and hiding them behind a menu would make
            the cheapest gesture on the page cost two taps. */}
        <div className="social-picker" role="group" aria-label="React to this workout">
          <SmilePlus size={15} className="social-picker-mark" aria-hidden />
          {social.emojis.map(e => (
            <button
              key={e}
              type="button"
              className={`social-emoji${social.myReaction === e ? ' mine' : ''}`}
              onClick={() => void react(e)}
              aria-pressed={social.myReaction === e}
              aria-label={social.myReaction === e ? `Remove your ${e} reaction` : `React with ${e}`}
            >
              {e}
            </button>
          ))}
        </div>
        {counts.length > 0 && (
          <ul className="social-tally">
            {counts.map(g => (
              <li
                key={g.emoji}
                className={g.people.some(p => p.author?.id === user?.id) ? 'mine' : undefined}
                // Who, not just how many — on an instance of a dozen people
                // that is the more interesting half.
                title={g.people.map(p => (p.author ? userLabel(p.author) : '')).filter(Boolean).join(', ')}
              >
                <span aria-hidden>{g.emoji}</span>
                <b>{g.people.length}</b>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="social-error">{error}</p>}

      {social.comments.length === 0 ? (
        <p className="social-empty">
          <MessageSquare size={15} aria-hidden />
          No comments yet.
        </p>
      ) : (
        <ul className="social-thread">
          {social.comments.map(c => {
            const mine = c.author?.id === user?.id
            return (
              <li key={c.id} className="social-comment">
                {c.author && <UserAvatar user={c.author} size={30} />}
                <div className="social-comment-body">
                  <div className="social-comment-head">
                    <b>{c.author ? userLabel(c.author) : 'Someone'}</b>
                    <time dateTime={c.createdAt}>{whenLabel(c.createdAt)}</time>
                    {c.updatedAt !== c.createdAt && <span className="social-edited">edited</span>}
                    <span className="social-comment-actions">
                      {/* Only the author may rewrite their own words. An owner
                          moderating their page can remove a comment, which is
                          a different thing from changing what it says. */}
                      {mine && (
                        <button
                          className="btn-icon"
                          onClick={() => setEditing({ id: c.id, body: c.body })}
                          title="Edit" aria-label="Edit comment"
                        >
                          <Pencil size={13} />
                        </button>
                      )}
                      {(mine || isOwner) && (
                        <button
                          className="btn-icon"
                          onClick={() => setConfirmDelete(c)}
                          title="Delete" aria-label="Delete comment"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </span>
                  </div>
                  {editing?.id === c.id ? (
                    <div className="social-edit">
                      <CommentBox
                        value={editing.body}
                        onChange={body => setEditing({ id: c.id, body })}
                        onSubmit={() => void saveEdit()}
                        ariaLabel="Edit comment"
                      />
                      <div className="social-edit-actions">
                        <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                        <button className="btn btn-primary" onClick={() => void saveEdit()} disabled={!editing.body.trim()}>
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="social-comment-text">{c.body}</p>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <div className="social-compose">
        <CommentBox
          value={draft}
          onChange={setDraft}
          onSubmit={() => void post()}
          ariaLabel="Write a comment"
          placeholder="Say something…"
        />
        <button className="btn btn-primary" onClick={() => void post()} disabled={!draft.trim() || posting}>
          {posting ? <><LoaderCircle size={14} className="spin" /> Posting…</> : 'Comment'}
        </button>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this comment?"
          message="It is removed for everyone this workout is shared with. This cannot be undone."
          confirmLabel="Delete"
          busyLabel="Deleting…"
          busy={deleting}
          danger
          onConfirm={() => void remove(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}

/**
 * The text box, growing with what is typed.
 *
 * A textarea and not an input, because a comment about a race is often two
 * sentences and a single-line box that scrolls sideways is unreadable. It is
 * sized from its own scrollHeight rather than by a row count, so it is exactly
 * as tall as the text and never leaves an empty band under one line.
 */
function CommentBox({ value, onChange, onSubmit, ariaLabel, placeholder }: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  ariaLabel: string
  placeholder?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Reset first: without it the box can only ever grow, because scrollHeight
    // of an already-tall element is its own height.
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [value])

  return (
    <textarea
      ref={ref}
      className="social-box"
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      rows={1}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => {
        // Enter posts, Shift+Enter breaks the line. The usual bargain, and the
        // one a phone keyboard's return key follows.
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          onSubmit()
        }
      }}
    />
  )
}

/** A short, local timestamp — the date once it is no longer today's business. */
function whenLabel(iso: string): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''
  const mins = Math.round((Date.now() - then.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`
  if (mins < 60 * 24 * 7) return `${Math.round(mins / (60 * 24))}d ago`
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
