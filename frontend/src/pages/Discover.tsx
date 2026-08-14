import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, Users as UsersIcon } from 'lucide-react'
import { api, type DirectoryUser } from '../lib/api'
import { useRefreshHandler } from '../context/RefreshContext'
import PageHeader from '../components/PageHeader'
import UserAvatar, { userLabel } from '../components/UserAvatar'

/**
 * Everyone on this instance.
 *
 * A self-hosted server is a handful of people who know each other, and until
 * now the only way to meet one was to be sent a workout by them. This is the
 * list, and each entry opens that person's profile.
 *
 * It shows names and taglines and nothing else — no email, no role, no activity
 * — because this is the one user listing open to every signed-in user rather
 * than to administrators. The server projects the same subset the share picker
 * gets, so there is nothing here to leak even if the page were wrong.
 */
export default function Discover({ onOpenUser }: { onOpenUser: (id: number) => void }) {
  const [users, setUsers] = useState<DirectoryUser[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    try {
      // Yourself included, and first: a directory you appear in reads oddly
      // with you missing from it.
      setUsers((await api.listUserDirectory({ includeSelf: true })).users)
    } catch {
      setUsers([])
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])
  useRefreshHandler(load)

  // Filtered here rather than by refetching per keystroke: this is everyone on
  // one server, which is a list that fits in memory several times over.
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return users
    return users.filter(u =>
      u.username.toLowerCase().includes(q)
      || u.displayName.toLowerCase().includes(q)
      || (u.tagline ?? '').toLowerCase().includes(q))
  }, [users, query])

  return (
    <>
      <PageHeader
        title="Discover"
        subtitle={`${users.length} ${users.length === 1 ? 'person' : 'people'} on this server`}
      />
      <div className="page-content">
        <div style={{ position: 'relative', marginBottom: 16 }}>
          <Search size={14} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', pointerEvents: 'none' }} />
          <input
            className="input"
            placeholder="Search people…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{ paddingLeft: 30, width: '100%' }}
            aria-label="Search people"
          />
        </div>

        {loading ? (
          <div className="field-hint">Loading…</div>
        ) : shown.length === 0 ? (
          <div className="card" style={{ padding: 28, textAlign: 'center', color: 'var(--text-3)' }}>
            <UsersIcon size={28} strokeWidth={1.5} style={{ margin: '0 auto 10px' }} aria-hidden />
            <div>{query ? 'Nobody matches that.' : 'Nobody else is on this server yet.'}</div>
          </div>
        ) : (
          <div className="discover-grid">
            {shown.map(u => (
              <button
                key={u.id}
                type="button"
                className="discover-card"
                onClick={() => onOpenUser(u.id)}
              >
                <UserAvatar user={u} size={44} />
                <span className="discover-body">
                  <span className="discover-name">
                    {userLabel(u)}
                    {u.self && <span className="admin-user-you">You</span>}
                  </span>
                  <span className="discover-handle">@{u.username}</span>
                  {u.tagline && <span className="discover-tagline">{u.tagline}</span>}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
