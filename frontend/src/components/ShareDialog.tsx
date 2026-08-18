import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Globe, Lock, X, Loader2 } from 'lucide-react'
import { api, ApiError, type ShareKind, type UserRef, type WorkoutShares } from '../lib/api'
import UserAvatar, { userLabel } from './UserAvatar'
import Modal from './Modal'
import SearchInput from './SearchInput'
import Skeleton from './Skeleton'

/** What the dialog names at the top, so there is no doubt what is about to
 *  become visible to other people. Built by each caller from its own shape —
 *  a workout, a plan, a session — since that's the one part not generic. */
interface ShareSubject {
  icon: ReactNode
  name: string
  meta: string
  /** A CSS colour for the icon's ring, matching the subject's own accent. */
  accent?: string
}

interface ShareDialogProps {
  kind: ShareKind
  id: string
  /** "workout" / "plan" / "session" — used only in the title and closing note. */
  noun: string
  subject: ShareSubject
  onClose: () => void
  /** Called with the new state after every change, so lists can re-badge. */
  onChange?: (state: WorkoutShares) => void
}

/**
 * Manages one item's sharing: a public toggle and a list of people it is
 * shared with directly. The two are deliberately independent — see the copy
 * under the toggle. Shared by workouts, plans and finished sessions — the
 * mechanics (a visibility flag, a share table, a directory picker) are
 * identical for all three, and only the subject header differs.
 */
/**
 * The dialog's shape while its two requests are in flight.
 *
 * A centred "Loading…" line was honest but a quarter of the height of what
 * replaced it, so the dialog visibly grew a moment after opening — under a
 * cursor already on its way to a control. This is not the real layout, only
 * its proportions.
 */
function LoadingShape() {
  return (
    <div aria-busy="true" aria-label="Loading sharing settings">
      <div className="share-section">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Skeleton width={16} height={16} radius={8} />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Skeleton width="45%" height={13} />
            <Skeleton width="80%" height={11} />
          </div>
          <Skeleton width={34} height={20} radius={99} />
        </div>
      </div>
      <div className="share-section">
        <Skeleton width="35%" height={12} />
        <div style={{ marginTop: 10 }}><Skeleton width="100%" height={34} radius={8} /></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Skeleton width={28} height={28} radius={99} />
              <Skeleton width={`${55 - i * 8}%`} height={13} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function ShareDialog({ kind, id, noun, subject, onClose, onChange }: ShareDialogProps) {
  const [state, setState] = useState<WorkoutShares | null>(null)
  const [directory, setDirectory] = useState<UserRef[]>([])
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([api.getShares(kind, id), api.listUserDirectory()])
      .then(([shares, dir]) => {
        if (cancelled) return
        setState(shares)
        setDirectory(dir.users)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : 'Could not load sharing settings')
      })
    return () => { cancelled = true }
  }, [kind, id])

  /** Runs a mutation, adopting whatever sharing state the server reports back. */
  async function mutate(run: () => Promise<WorkoutShares | unknown>, refetch = false) {
    setBusy(true)
    setError(null)
    try {
      const result = await run()
      const next = refetch ? await api.getShares(kind, id) : result as WorkoutShares
      setState(next)
      onChange?.(next)
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const sharedIds = useMemo(() => new Set(state?.sharedWith.map(u => u.id) ?? []), [state])
  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase()
    return directory.filter(u =>
      !sharedIds.has(u.id) &&
      (q === '' || u.username.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q)),
    )
  }, [directory, sharedIds, search])

  const isPublic = state?.visibility === 'public'

  return (
    <Modal onClose={onClose} label={`Share ${noun}`}>
        <div className="modal-box" style={{ maxWidth: 480 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, flex: 1 }}>Share {noun}</h3>
            <button className="btn-icon" onClick={onClose} aria-label="Close"><X size={16} /></button>
          </div>

          {/* Naming the subject plainly matters here: this dialog is the one
              place where getting the wrong one wrong exposes it to other
              people. */}
          <div className="share-subject" style={{ '--row-accent': subject.accent ?? 'var(--primary)' } as React.CSSProperties}>
            <span className="share-subject-icon">{subject.icon}</span>
            <span style={{ minWidth: 0, flex: 1 }}>
              <span className="share-subject-name">{subject.name}</span>
              <span className="share-subject-meta">{subject.meta}</span>
            </span>
          </div>

          {error && (
            <p style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 12 }}>{error}</p>
          )}

          {state === null ? (
            <LoadingShape />
          ) : (
            <>
              {/* Visibility */}
              <div className="share-section">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {isPublic ? <Globe size={16} color="var(--primary)" /> : <Lock size={16} color="var(--text-3)" />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {isPublic ? 'Visible to everyone here' : 'Private'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                      {isPublic
                        ? 'Anyone signed in to this instance can find and open it.'
                        : 'Only you, and anyone you share with below.'}
                    </div>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={isPublic}
                      disabled={busy}
                      onChange={e => void mutate(() => api.setVisibility(kind, id, e.target.checked ? 'public' : 'private'))}
                    />
                    <span className="switch-track" />
                  </label>
                </div>
              </div>

              {/* Direct shares */}
              <div className="share-section">
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Shared with</span>
                  <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                    {state.sharedWith.length}
                  </span>
                  {state.sharedWith.length > 0 && (
                    <button
                      className="btn btn-ghost"
                      style={{ marginLeft: 'auto', fontSize: 11, padding: '3px 8px' }}
                      disabled={busy}
                      onClick={() => void mutate(
                        () => Promise.all(state.sharedWith.map(u => api.removeShare(kind, id, u.id))),
                        true,
                      )}
                    >
                      Remove everyone
                    </button>
                  )}
                </div>

                {state.sharedWith.length > 0 && (
                  <div className="share-chips">
                    {state.sharedWith.map(u => (
                      <span key={u.id} className="share-chip">
                        <UserAvatar user={u} size={20} />
                        {userLabel(u)}
                        <button
                          onClick={() => void mutate(() => api.removeShare(kind, id, u.id), true)}
                          disabled={busy}
                          aria-label={`Stop sharing with ${userLabel(u)}`}
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <div style={{ marginTop: 10 }}>
                  <SearchInput
                    value={search}
                    onChange={setSearch}
                    placeholder="Find someone…"
                    grow={false}
                    minWidth={0}
                  />
                </div>

                <div className="share-people">
                  {candidates.length === 0 ? (
                    <p style={{ fontSize: 12, color: 'var(--text-3)', padding: '10px 2px' }}>
                      {directory.length === 0 ? 'Nobody else has an account here yet.' : 'No matches.'}
                    </p>
                  ) : candidates.map(u => (
                    <button
                      key={u.id}
                      className="share-person"
                      disabled={busy}
                      onClick={() => void mutate(() => api.addShare(kind, id, u.id))}
                    >
                      <UserAvatar user={u} size={26} />
                      <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                        <span style={{ display: 'block', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{userLabel(u)}</span>
                        <span style={{ display: 'block', fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>@{u.username}</span>
                      </span>
                      {busy ? <Loader2 size={14} className="spin" /> : <span style={{ fontSize: 11, color: 'var(--primary)' }}>Share</span>}
                    </button>
                  ))}
                </div>
              </div>

              {/* The two mechanisms are independent by design, and that is not
                  obvious from the controls alone — so it is stated outright. */}
              <p style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5, marginTop: 14 }}>
                Making a {noun} private again does not remove the people listed above — revoke them individually if you want to.
              </p>
            </>
          )}
        </div>
    </Modal>
  )
}
