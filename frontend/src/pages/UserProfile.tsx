import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Globe, Handshake, LoaderCircle, Send } from 'lucide-react'
import { api, ApiError, type UserProfileData } from '../lib/api'
import type { Workout } from '../data/workouts'
import { useRefreshHandler } from '../context/RefreshContext'
import { useSessionState } from '../lib/useSessionState'
import ExpandModal from '../components/ExpandModal'
import TabStrip from '../components/TabStrip'
import UserAvatar, { avatarUrl, userLabel } from '../components/UserAvatar'
import WorkoutFilterList from '../components/WorkoutFilterList'

/**
 * The last profile fetched, kept across unmounts.
 *
 * The header is the person — avatar, name, tagline — so a render with no data
 * is a header with no name, and anything that remounts this page shows the bare
 * back arrow for as long as the request takes. That was visible as the name
 * flashing in and out when moving around the page.
 *
 * Module-level rather than state precisely because state does not survive the
 * remount this exists to cover. One entry, not a map: you look at one profile
 * at a time, and a cache that grows is a cache that goes stale.
 */
let lastProfile: { id: number; data: UserProfileData } | null = null

/**
 * Which set of workouts is on screen.
 *
 * Three, because there are three distinct relationships between two people and
 * a workout, and collapsing any pair of them loses the thing you came to see:
 * what they sent you, what you sent them, and what they put out to everyone.
 */
type Tab = 'with-me' | 'with-them' | 'public'

/**
 * Another member of this instance, and the workouts you and they can see of
 * each other's.
 *
 * Nothing here is new access. "With me" and "Public" come from the same two
 * feeds Discover renders, and "With them" is the caller's own library filtered
 * by who they shared it with — so every row was already visible to whoever is
 * looking. It is a different arrangement of the same permission, by person
 * rather than by recency.
 *
 * Your own profile is the same idea pointed at yourself: Public is what
 * everyone signed in here can see of you, and Shared is what you have sent to
 * named people — the outbound half, which until now was only reachable as a
 * toggle inside the library's filters. "With me" is dropped, because nobody
 * shares a workout with themselves.
 */
export default function UserProfile({ id, onBack, onSelect, onOpenUser }: {
  id: number
  onBack: () => void
  onSelect: (w: Workout) => void
  /** Opens one of the people a workout of yours was shared with. */
  onOpenUser: (id: number) => void
}) {
  // Seeded from the cache, so returning to a profile draws the person at once
  // and the fetch below only ever corrects it.
  const [data, setData] = useState<UserProfileData | null>(
    () => (lastProfile?.id === id ? lastProfile.data : null))
  const [err, setErr] = useState<string | null>(null)
  /**
   * Kept across unmounts, because opening a workout from here replaces this
   * page: the tab you were reading was gone by the time you pressed back, and
   * every workout you looked at cost you the tab again. Per session, not
   * forever — which tab you were on is part of what you are doing now.
   */
  const [{ tab: storedTab }, setTabState] = useSessionState<{ tab: Tab }>('al_profile_tab', { tab: 'with-me' })
  const setTab = useCallback((t: Tab) => setTabState({ tab: t }), [setTabState])
  const [zoomed, setZoomed] = useState(false)

  const load = useCallback(async () => {
    try {
      const d = await api.getUserProfile(id)
      lastProfile = { id, data: d }
      setData(d)
      // Your own profile has only one tab, and a remembered "with me" would
      // land on a tab this page does not offer. Anything else is left alone, so
      // a refresh — or coming back from a workout — keeps the tab you chose.
      setErr(null)
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not load this profile')
    }
  }, [id])
  useEffect(() => { void load() }, [load])
  useRefreshHandler(load)

  // Only before anyone has been seen at all — with the cache above, that is a
  // cold open of a profile and nothing else. The header is the back arrow and
  // nothing else; it used to carry the word "Profile", which was then replaced
  // by the avatar and name a moment later, and a title that appears only to be
  // swapped out reads as the page having loaded the wrong thing first.
  if (err || !data) {
    return (
      <>
        <div className="page-header page-header-row profile-header">
          <button className="btn-icon page-header-back" onClick={onBack} aria-label="Back">
            <ArrowLeft size={18} />
          </button>
        </div>
        {err ? (
          <div className="page-content settings-page">
            <div className="settings-card danger"><span className="status-msg err">{err}</span></div>
          </div>
        ) : (
          <div className="detail-loading"><LoaderCircle size={18} className="spin" /></div>
        )}
      </>
    )
  }

  // Your own profile does not offer "With me" — nobody shares a workout with
  // themselves — so a tab remembered from someone else's profile is folded
  // rather than left pointing at a strip that has no such button. Derived
  // instead of corrected in an effect: an effect here would rewrite stored
  // state during a render that has already had to cope without it.
  const tab: Tab = data.self && storedTab === 'with-me' ? 'public' : storedTab
  const name = userLabel(data.user)
  const tabs = data.self
    ? [
      { id: 'with-them' as Tab, label: 'Shared', icon: <Send size={14} /> },
      { id: 'public' as Tab, label: 'Public', icon: <Globe size={14} /> },
    ]
    // "by me" against "with me": one word apart, and the direction is in both.
    // An unqualified "Shared" beside "Shared with me" leaves the reader to
    // infer that the short one means the opposite way round.
    : [
      { id: 'with-me' as Tab, label: 'Shared with me', icon: <Handshake size={14} /> },
      { id: 'with-them' as Tab, label: 'Shared by me', icon: <Send size={14} /> },
      { id: 'public' as Tab, label: 'Public', icon: <Globe size={14} /> },
    ]

  // Three named lists from the server rather than one merged one to slice
  // apart: which rows are which is the server's answer to give.
  const rows = tab === 'with-them'
    ? data.sharedWithThem
    : tab === 'public'
      ? data.publicWorkouts
      : data.sharedWithMe

  const empty = tab === 'with-them'
    ? data.self
      ? 'You have not shared any workout with anyone yet.'
      : `You have not shared anything with ${name}.`
    : tab === 'public'
      ? data.self ? 'You have not made any workout public.' : `${name} has no public workouts.`
      : `${name} has not shared anything with you.`

  return (
    <>
      {/* The person *is* the title here, so they take the header rather than
          the word "User" sitting above a second copy of the same name. Built
          from the page-header classes so the back arrow lands in exactly the
          place it does on every other page. */}
      <div className="page-header page-header-row profile-header">
        <button className="btn-icon page-header-back" onClick={onBack} aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <button
          type="button"
          className="profile-avatar-btn"
          onClick={() => setZoomed(true)}
          aria-label={`Show ${name}'s picture`}
          title="Show picture"
        >
          <UserAvatar user={data.user} size={56} />
        </button>
        <div className="page-header-text">
          <h1 className="profile-name">{name}</h1>
          <p className="profile-handle">@{data.user.username}</p>
          {data.tagline && <p className="profile-tagline">{data.tagline}</p>}
        </div>
      </div>

      <div className="page-content">
        <TabStrip items={tabs} value={tab} onChange={setTab} ariaLabel="Which workouts" fill />

        <WorkoutFilterList
          // Keyed by tab so switching starts the next list at the top with its
          // own search rather than inheriting the previous tab's.
          key={tab}
          rows={rows}
          scope={tab === 'with-them' ? 'mine' : 'shared'}
          storageKey={`profile.${tab}`}
          emptyMessage={empty}
          onSelect={onSelect}
          // Only on your own outbound list: everywhere else on this page the
          // rows belong to the person in the header, and naming them again
          // under every card says nothing.
          byline={data.self && tab === 'with-them' ? 'recipients' : undefined}
          onOpenUser={onOpenUser}
        />
      </div>

      {zoomed && (
        <ExpandModal title={name} onClose={() => setZoomed(false)}>
          <img className="profile-avatar-full" src={avatarUrl(data.user)} alt={`${name}'s picture`} />
        </ExpandModal>
      )}
    </>
  )
}
