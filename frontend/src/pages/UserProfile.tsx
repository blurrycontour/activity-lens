import { useCallback, useEffect, useState } from 'react'
import { Globe, Handshake, LoaderCircle } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import type { Workout } from '../data/workouts'
import { useRefreshHandler } from '../context/RefreshContext'
import PageHeader from '../components/PageHeader'
import UserAvatar, { userLabel } from '../components/UserAvatar'
import WorkoutCard from '../components/WorkoutCard'

interface Profile {
  user: { id: number; username: string; displayName: string; avatarPath: string }
  sharedWithMe: number
  public: number
  workouts: Workout[]
}

/**
 * Another member of this instance, and the workouts of theirs you can see.
 *
 * Everything here is already visible to you — the server builds the list from
 * the same two feeds the Shared and Public tabs render, so this page shows no
 * workout that those tabs would not. It is a different arrangement of the same
 * permission, by person rather than by recency.
 *
 * A page rather than a dialog because the list is the substance of it: a
 * profile with a dozen workouts in a modal is a list scrolling inside a box,
 * and this way the back gesture returns to the workout you came from.
 */
export default function UserProfile({ id, onBack, onSelect }: {
  id: number
  onBack: () => void
  onSelect: (w: Workout) => void
}) {
  const [data, setData] = useState<Profile | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await api.getUserProfile(id))
      setErr(null)
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not load this profile')
    }
  }, [id])
  useEffect(() => { void load() }, [load])
  useRefreshHandler(load)

  if (err) {
    return (
      <>
        <PageHeader title="Profile" onBack={onBack} />
        <div className="page-content settings-page">
          <div className="settings-card danger"><span className="status-msg err">{err}</span></div>
        </div>
      </>
    )
  }
  if (!data) {
    return (
      <>
        <PageHeader title="Profile" onBack={onBack} />
        <div className="detail-loading"><LoaderCircle size={18} className="spin" /></div>
      </>
    )
  }

  const name = userLabel(data.user)
  const total = data.workouts.length

  return (
    <>
      <PageHeader title={name} onBack={onBack} />
      <div className="page-content">
        <div className="profile-head">
          <UserAvatar user={data.user} size={64} />
          <div style={{ minWidth: 0 }}>
            <div className="profile-name">{name}</div>
            {/* Only when it says something the name did not — a display name of
                "alice" over a username of "alice" is one fact printed twice. */}
            {data.user.displayName && data.user.displayName !== data.user.username && (
              <div className="profile-handle">@{data.user.username}</div>
            )}
            <div className="profile-counts">
              {/* Split, because the two are different relationships: one they
                  chose to send you, the other is open to everyone here. */}
              <span><Handshake size={13} /> {data.sharedWithMe} shared with you</span>
              <span><Globe size={13} /> {data.public} public</span>
            </div>
          </div>
        </div>

        <h2 className="card-title" style={{ margin: '20px 0 10px' }}>
          Workouts you can see <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>({total})</span>
        </h2>

        {total === 0 ? (
          <div className="card" style={{ padding: 28, textAlign: 'center', color: 'var(--text-3)' }}>
            {name} has not shared anything with you.
          </div>
        ) : (
          <div className="workout-list">
            {/* The same row the library draws, so a workout looks like a
                workout wherever you meet it. */}
            {data.workouts.map(w => (
              <WorkoutCard key={w.id} workout={w} variant="list" onClick={() => onSelect(w)} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}
