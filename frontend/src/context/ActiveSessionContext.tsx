import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import {
  clearSessionNotice, repostSessionNotice, sessionNoticeClaimed, showSessionNotice,
} from '../lib/native/sessionNotice'
import { useAuth } from './AuthContext'
import type { PlanSession } from '../data/plans'

interface ActiveSessionValue {
  /** The training session in progress, or null when there is none. */
  active: PlanSession | null
  /** Re-reads it from the server — after starting, finishing or discarding. */
  refresh: () => Promise<void>
  /** Sets it locally, for the page that just caused the change. */
  set: (s: PlanSession | null) => void
}

const Ctx = createContext<ActiveSessionValue>({
  active: null,
  refresh: async () => {},
  set: () => {},
})

/**
 * Whether a training session is running, known app-wide.
 *
 * Three places need this and none of them own it: the dashboard's resume card,
 * the plans page, and the navigation, which shows a live dot on Plans so a
 * session left running is visible from anywhere in the app. Each was asking the
 * server for itself, which is three requests for one boolean and three copies
 * that could disagree after a session was finished on one of them.
 */
export function ActiveSessionProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [active, setActive] = useState<PlanSession | null>(null)

  const refresh = useCallback(async () => {
    try {
      // 204 when nothing is running, which the client turns into undefined.
      setActive((await api.activePlanSession()) ?? null)
    } catch {
      // A failure leaves whatever was known. This drives an indicator, not a
      // decision — a wrong answer here is a dot, and an error would be worse.
    }
  }, [])

  useEffect(() => {
    if (!user) { setActive(null); return }
    void refresh()
  }, [user, refresh])

  /*
   * The ongoing notification, kept alive from wherever you are in the app.
   *
   * The runner posts a far better one — what you are on, what is next, the rest
   * counting down — but it is only mounted while the session is on screen, and
   * the notification has to survive being swiped away and the app being opened
   * on some other page. So this is the floor: if a session is running and
   * nothing has posted a notice, post a plain one; whenever the app comes back
   * to the foreground, put whatever is remembered back up.
   *
   * There is no event for a notification being dismissed and no way to ask
   * whether one is still showing, so re-posting on every return is the only
   * thing that can be relied on. Posting an identical notification under the
   * same id is free when it is already there.
   */
  useEffect(() => {
    if (!active) {
      // Nothing running: anything left in the shade is stale. This is also
      // what clears it after a session was finished on another device.
      void clearSessionNotice()
      return
    }
    const post = () => {
      if (document.visibilityState !== 'visible') return
      // The runner is on screen and its notice is the better one; anything
      // built here would be a worse copy of what it already posted.
      if (sessionNoticeClaimed()) { void repostSessionNotice(); return }
      void showSessionNotice({
        sessionId: active.id,
        // The same shape the runner posts, with the little this knows to fill
        // it with: it has the tally and not the exercise.
        title: 'Session in progress',
        body: `${active.doneSets}/${active.totalSets} sets`,
        done: active.doneSets,
        total: active.totalSets,
        subText: `${active.dayName} · ${active.planName}`,
        startedAt: active.startedAt,
      })
    }
    post()
    document.addEventListener('visibilitychange', post)
    window.addEventListener('focus', post)
    return () => {
      document.removeEventListener('visibilitychange', post)
      window.removeEventListener('focus', post)
    }
  }, [active])

  const value = useMemo(() => ({ active, refresh, set: setActive }), [active, refresh])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useActiveSession(): ActiveSessionValue {
  return useContext(Ctx)
}
