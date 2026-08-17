import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
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

  const value = useMemo(() => ({ active, refresh, set: setActive }), [active, refresh])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useActiveSession(): ActiveSessionValue {
  return useContext(Ctx)
}
