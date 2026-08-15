import { useEffect, useMemo, useState } from 'react'
import { Globe, Lock, X, Loader2 } from 'lucide-react'
import { api, ApiError, type UserRef, type WorkoutShares } from '../lib/api'
import { fmtDist, fmtDuration, TYPE_COLOR, type Workout } from '../data/workouts'
import TypeIcon from './TypeIcon'
import UserAvatar, { userLabel } from './UserAvatar'
import Modal from './Modal'
import SearchInput from './SearchInput'

interface ShareDialogProps {
  /** The workout being shared. Identified prominently so there is no doubt
   *  which one is about to become visible to other people. */
  workout: Workout
  onClose: () => void
  /** Called with the new state after every change, so lists can re-badge. */
  onChange?: (state: WorkoutShares) => void
}

/**
 * Manages one workout's sharing: a public toggle and a list of people it is
 * shared with directly. The two are deliberately independent — see the copy
 * under the toggle.
 */
export default function ShareDialog({ workout, onClose, onChange }: ShareDialogProps) {
  const workoutId = workout.id
  const [state, setState] = useState<WorkoutShares | null>(null)
  const [directory, setDirectory] = useState<UserRef[]>([])
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([api.getShares(workoutId), api.listUserDirectory()])
      .then(([shares, dir]) => {
        if (cancelled) return
        setState(shares)
        setDirectory(dir.users)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : 'Could not load sharing settings')
      })
    return () => { cancelled = true }
  }, [workoutId])

  /** Runs a mutation, adopting whatever sharing state the server reports back. */
  async function mutate(run: () => Promise<WorkoutShares | unknown>, refetch = false) {
    setBusy(true)
    setError(null)
    try {
      const result = await run()
      const next = refetch ? await api.getShares(workoutId) : result as WorkoutShares
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
    <Modal onClose={onClose} label="Share workout">
        <div className="modal-box" style={{ maxWidth: 480 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, flex: 1 }}>Share workout</h3>
            <button className="btn-icon" onClick={onClose} aria-label="Close"><X size={16} /></button>
          </div>

          {/* Naming the workout plainly matters here: this dialog is the one
              place where getting the wrong one wrong exposes it to other
              people. */}
          <div className="share-subject" style={{ '--row-accent': TYPE_COLOR[workout.type] } as React.CSSProperties}>
            <span className="share-subject-icon"><TypeIcon type={workout.type} /></span>
            <span style={{ minWidth: 0, flex: 1 }}>
              <span className="share-subject-name">{workout.name}</span>
              <span className="share-subject-meta">
                {new Date(workout.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                {workout.distance > 0 && <> · {fmtDist(workout.distance)}</>}
                {workout.duration > 0 && <> · {fmtDuration(workout.duration)}</>}
              </span>
            </span>
          </div>

          {error && (
            <p style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 12 }}>{error}</p>
          )}

          {state === null ? (
            <p style={{ fontSize: 13, color: 'var(--text-3)', padding: '20px 0', textAlign: 'center' }}>Loading…</p>
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
                      onChange={e => void mutate(() => api.setVisibility(workoutId, e.target.checked ? 'public' : 'private'))}
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
                        () => Promise.all(state.sharedWith.map(u => api.removeShare(workoutId, u.id))),
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
                          onClick={() => void mutate(() => api.removeShare(workoutId, u.id), true)}
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
                      onClick={() => void mutate(() => api.addShare(workoutId, u.id))}
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
                Making a workout private again does not remove the people listed above — revoke them individually if you want to.
              </p>
            </>
          )}
        </div>
    </Modal>
  )
}
