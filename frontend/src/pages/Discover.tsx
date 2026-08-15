import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDownAZ, ArrowUpAZ, Globe, Inbox, Search, Users as UsersIcon } from 'lucide-react'
import { api, type DirectoryUser } from '../lib/api'
import type { Workout } from '../data/workouts'
import { useRefreshHandler } from '../context/RefreshContext'
import PageHeader from '../components/PageHeader'
import TabStrip from '../components/TabStrip'
import UserAvatar, { userLabel } from '../components/UserAvatar'
import WorkoutFilterList from '../components/WorkoutFilterList'
import { useSessionState } from '../lib/useSessionState'

type Tab = 'people' | 'shared' | 'public'

const TABS = [
  { id: 'people' as Tab, label: 'People', icon: <UsersIcon size={14} /> },
  { id: 'shared' as Tab, label: 'Shared with me', icon: <Inbox size={14} /> },
  { id: 'public' as Tab, label: 'Public', icon: <Globe size={14} /> },
]

/**
 * Other people on this instance, and their workouts.
 *
 * Everything here belongs to somebody else, which is the whole point of the
 * page — and the reason the two feeds moved here out of the library. Workouts
 * is your own training log; having it also be the place you read other people's
 * made "how far did I run last month" and "what did Alice post" the same screen
 * with a tab between them, and the header count, the import button and bulk
 * selection all had to be qualified by which tab you were on.
 *
 * People comes first because it is the only one of the three that is a list of
 * *people*; the feeds are ways into the same profiles by recency instead.
 */
export default function Discover({ onOpenUser, onSelectWorkout }: {
  onOpenUser: (id: number) => void
  onSelectWorkout: (w: Workout) => void
}) {
  // Per session, so opening a workout from a feed and coming back lands on the
  // feed rather than on the directory.
  const [{ tab }, setTabState] = useSessionState<{ tab: Tab }>('discover.tab', { tab: 'people' })
  const setTab = useCallback((t: Tab) => setTabState({ tab: t }), [setTabState])

  const [users, setUsers] = useState<DirectoryUser[]>([])
  const [loadingPeople, setLoadingPeople] = useState(true)
  const [query, setQuery] = useState('')
  /**
   * Alphabetical, either way round. Not persisted: a directory of a dozen
   * people is read at a glance, and a remembered Z→A would be a puzzle on the
   * next visit rather than a preference honoured.
   */
  const [az, setAz] = useState(true)
  // undefined until fetched, which is what tells the list to say "loading"
  // rather than "nothing here".
  const [feeds, setFeeds] = useState<Partial<Record<'shared' | 'public', Workout[]>>>({})
  const [feedError, setFeedError] = useState<string | null>(null)

  const loadPeople = useCallback(async () => {
    try {
      // Yourself included, and first: a directory you appear in reads oddly
      // with you missing from it.
      setUsers((await api.listUserDirectory({ includeSelf: true })).users)
    } catch {
      setUsers([])
    } finally {
      setLoadingPeople(false)
    }
  }, [])

  const loadFeed = useCallback(async (s: 'shared' | 'public') => {
    setFeedError(null)
    try {
      const rows = s === 'public' ? await api.feedPublic() : await api.feedShared()
      setFeeds(f => ({ ...f, [s]: rows }))
    } catch {
      setFeedError('Could not load these workouts.')
    }
  }, [])

  useEffect(() => { void loadPeople() }, [loadPeople])
  // Fetched on first visit to their tab rather than on mount, so arriving at
  // the directory costs one request and not three.
  useEffect(() => {
    if (tab !== 'people' && feeds[tab] === undefined) void loadFeed(tab)
  }, [tab, feeds, loadFeed])

  // A pull refreshes whatever is on screen.
  useRefreshHandler(useCallback(
    () => (tab === 'people' ? loadPeople() : loadFeed(tab)),
    [tab, loadPeople, loadFeed],
  ))

  // Filtered here rather than by refetching per keystroke: this is everyone on
  // one server, which is a list that fits in memory several times over.
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matched = q
      ? users.filter(u =>
        u.username.toLowerCase().includes(q)
        || u.displayName.toLowerCase().includes(q)
        || (u.tagline ?? '').toLowerCase().includes(q))
      : users
    // You stay pinned to the top whichever way the rest is sorted: this is a
    // directory you appear in, and hunting for yourself under S is silly.
    // localeCompare, so accented names sort where a reader expects them.
    const rest = matched.filter(u => !u.self)
      .sort((a, b) => userLabel(a).localeCompare(userLabel(b)) * (az ? 1 : -1))
    return [...matched.filter(u => u.self), ...rest]
  }, [users, query, az])

  return (
    <>
      <PageHeader
        title="Discover"
        subtitle={tab === 'people'
          ? `${users.length} ${users.length === 1 ? 'person' : 'people'} on this server`
          : tab === 'shared' ? 'Workouts other people have sent you' : 'Open to everyone signed in here'}
      />
      <div className="page-content">
        <TabStrip items={TABS} value={tab} onChange={setTab} ariaLabel="What to discover" fill />

        {tab === 'people' ? (
          <>
            <div className="discover-tools">
            <div style={{ position: 'relative', flex: 1, minWidth: 160 }}>
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
            <button
              className="btn btn-ghost"
              onClick={() => setAz(v => !v)}
              title={az ? 'Sorted A to Z' : 'Sorted Z to A'}
              aria-label={az ? 'Sorted A to Z; switch to Z to A' : 'Sorted Z to A; switch to A to Z'}
            >
              {az ? <ArrowDownAZ size={15} /> : <ArrowUpAZ size={15} />}
              {az ? 'A–Z' : 'Z–A'}
            </button>
            </div>

            {loadingPeople ? (
              <div className="field-hint">Loading…</div>
            ) : shown.length === 0 ? (
              <div className="feed-empty">
                <UsersIcon size={28} strokeWidth={1.5} style={{ margin: '0 auto 10px' }} aria-hidden />
                <div>{query ? 'Nobody matches that.' : 'Nobody else is on this server yet.'}</div>
              </div>
            ) : (
              /* Names and taglines and nothing else — no email, no role, no
                 activity — because this is the one user listing open to every
                 signed-in user rather than to administrators. The server
                 projects the same subset the share picker gets, so there is
                 nothing here to leak even if the page were wrong. */
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
          </>
        ) : (
          <WorkoutFilterList
            // Keyed so switching tabs starts the other feed's list at the top
            // with its own search, rather than inheriting this one's.
            key={tab}
            rows={feeds[tab]}
            scope={tab}
            storageKey={`discover.${tab}`}
            error={feedError}
            emptyMessage={tab === 'shared'
              ? 'Nobody has shared a workout with you yet.'
              : 'No public workouts on this instance yet.'}
            onSelect={onSelectWorkout}
            byline="owner"
            onOpenUser={onOpenUser}
          />
        )}
      </div>
    </>
  )
}
