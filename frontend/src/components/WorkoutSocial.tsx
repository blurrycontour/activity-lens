import { useCallback, useEffect, useRef, useState } from 'react'
import { LoaderCircle, MessageSquare, Pencil, SendHorizontal, SmilePlus, Trash2 } from 'lucide-react'
import ConfirmDialog from './ConfirmDialog'
import UserAvatar, { userLabel } from './UserAvatar'
import { useAuth } from '../context/AuthContext'
import { api, ApiError, type ShareKind, type WorkoutComment, type WorkoutSocial as Social } from '../lib/api'
import useEscape from '../lib/useEscape'
import { whenLabel } from '../lib/date'
import { PUSH_EVENT } from '../lib/notifications'

/**
 * The DOM id one comment is anchored by, so a notification can point at it.
 *
 * Prefixed rather than using the raw comment id: these ids share a document
 * with everything else on the workout page, and an anchor that is just an
 * opaque string is one nobody reading the HTML can place.
 */
function commentDomId(id: string): string {
  return `comment-${id}`
}

/**
 * Reactions and comments on a shared workout, training plan or session.
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
  /** What the conversation hangs off. All three share one set of endpoints. */
  kind: ShareKind
  workoutId: string
  /** Owners may remove any comment; everyone may remove their own. */
  isOwner: boolean
  /** The noun used when there is nothing to show, so the empty state names
   *  the right thing. */
  noun?: string
  /**
   * How many comments there turned out to be, so the tab that opened this can
   * keep its badge honest after one is posted or deleted. Must be stable
   * across renders — it is an effect dependency.
   */
  onCount?: (n: number) => void
  /**
   * A comment a notification pointed at: scrolled to and flashed once the
   * thread has loaded. Null when the reader simply opened the tab.
   */
  focusCommentId?: string | null
  /** Called once the focus has been honoured, or found to be unreachable. */
  onFocused?: () => void
}

/**
 * How often an open thread re-reads itself.
 *
 * Only while the tab is on screen and the document is visible, so this is not
 * a background cost: a panel nobody is looking at makes no requests at all.
 * Five seconds is close enough to feel live in a conversation without being a
 * request rate worth thinking about for the handful of people who can see any
 * one workout.
 */
const REFRESH_MS = 5000

export default function WorkoutSocial({ kind, workoutId, isOwner, noun = 'workout', onCount, focusCommentId, onFocused }: WorkoutSocialProps) {
  const { user } = useAuth()
  const [social, setSocial] = useState<Social | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<WorkoutComment | null>(null)
  const [deleting, setDeleting] = useState(false)
  // The tray is closed until asked for. Six emoji laid out permanently is a
  // row of controls competing with the reactions people actually left, which
  // are the thing worth looking at.
  const [picking, setPicking] = useState(false)
  const pickerWrap = useRef<HTMLDivElement>(null)

  // A tray that only closes by picking something is a tray you have to
  // dismiss by using it. Pointerdown rather than click, so it closes on the
  // press that starts an interaction elsewhere rather than on its release —
  // and capture, so a control underneath cannot stop the event first.
  useEscape(picking, () => setPicking(false))
  useEffect(() => {
    if (!picking) return
    const away = (e: Event) => {
      if (!pickerWrap.current?.contains(e.target as Node)) setPicking(false)
    }
    document.addEventListener('pointerdown', away, true)
    return () => document.removeEventListener('pointerdown', away, true)
  }, [picking])

  const load = useCallback(async () => {
    try {
      setSocial(await api.workoutSocial(kind, workoutId))
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load comments.')
    }
  }, [workoutId])

  useEffect(() => { void load() }, [load])

  /**
   * Keeps an open thread current, so a comment posted by someone else appears
   * where you are reading rather than the next time you open the page.
   *
   * Polled rather than pushed. There is no realtime channel in this app and one
   * long-lived connection per reader is a lot of new machinery for one panel,
   * so this leans on the two things that already exist: a timer, and the push
   * event App raises when a notification arrives while the app is open. The
   * push is what makes the common case immediate — the person who commented is
   * the reason you have a notification — and the timer is what covers everyone
   * who has push turned off.
   *
   * Both are gated on the document being visible. A backgrounded tab makes no
   * requests, and coming back to one refreshes it at once rather than waiting
   * out the interval — which is also what makes returning from another app show
   * the conversation as it stands.
   */
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') void load() }
    const id = setInterval(tick, REFRESH_MS)
    // Also on the way back in, so the first thing a returning reader sees is
    // current rather than up to REFRESH_MS old.
    document.addEventListener('visibilitychange', tick)
    window.addEventListener(PUSH_EVENT, tick)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
      window.removeEventListener(PUSH_EVENT, tick)
    }
  }, [load])

  /**
   * Takes the reader to the comment a notification named.
   *
   * Waits for the thread, because the panel is lazy and the id arrives before
   * the comments do. When the comment is not in the thread — deleted between
   * the notification going out and being opened, which is the case worth
   * handling rather than assuming away — the reader is left on the tab, which
   * is the fallback the link was built to have.
   *
   * `onFocused` fires either way, so the target is spent once and re-rendering
   * does not keep yanking the page back to it.
   */
  useEffect(() => {
    if (!focusCommentId || !social) return
    const el = document.getElementById(commentDomId(focusCommentId))
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      // A flash rather than a lasting mark: it answers "which one" and then
      // gets out of the way. Driven by a class the stylesheet animates once.
      el.classList.add('social-comment-flash')
      window.setTimeout(() => el.classList.remove('social-comment-flash'), 2200)
    }
    onFocused?.()
  }, [focusCommentId, social, onFocused])

  // From the loaded thread rather than from each of post, edit and delete —
  // one place that cannot be forgotten by a fourth.
  useEffect(() => { if (social) onCount?.(social.comments.length) }, [social, onCount])

  async function react(emoji: string) {
    if (!social) return
    // Tapping the one already chosen clears it; the server reads an empty
    // string as "remove mine", so the toggle is one request either way.
    const next = social.myReaction === emoji ? '' : emoji
    try {
      setSocial(await api.setWorkoutReaction(kind, workoutId, next))
      setPicking(false)
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
      const c = await api.addComment(kind, workoutId, body)
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
      const c = await api.editComment(kind, workoutId, editing.id, body)
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
      await api.deleteComment(kind, workoutId, comment.id)
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
        Share this {noun} to open it for comments and reactions.
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
        {/* One button, and the set behind it. The tray closes on a pick and on
            a second press of the button, so reacting is two taps and changing
            your mind is two more — but the resting state is one control rather
            than a row of six competing with the reactions people left. */}
        <div className="social-picker-wrap" ref={pickerWrap}>
          <button
            type="button"
            className={`btn-icon social-picker-btn${picking ? ' open' : ''}`}
            onClick={() => setPicking(p => !p)}
            aria-expanded={picking}
            aria-label={picking ? 'Close the reactions' : 'React to this workout'}
            title="React"
          >
            <SmilePlus size={16} />
          </button>
          {picking && (
            <div className="social-picker" role="group" aria-label="Pick a reaction">
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
          )}
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
              <li key={c.id} id={commentDomId(c.id)} className="social-comment">
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
        <button
          className="btn-icon social-send"
          onClick={() => void post()}
          disabled={!draft.trim() || posting}
          title="Post comment"
          aria-label="Post comment"
        >
          {posting ? <LoaderCircle size={16} className="spin" /> : <SendHorizontal size={16} />}
        </button>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this comment?"
          message={`It is removed for everyone this ${noun} is shared with. This cannot be undone.`}
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

