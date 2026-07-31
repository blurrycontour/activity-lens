import { useCallback, useState } from 'react'

/**
 * State that survives a component unmounting, but not a new session.
 *
 * The case this exists for: opening a workout replaces the list page entirely,
 * so anything the list held — a search, a type filter, a sort — was gone by the
 * time the user pressed back, and had to be set up again for every result they
 * looked at.
 *
 * sessionStorage rather than localStorage, deliberately. A filter is part of
 * what you are doing right now, not a preference: coming back to the app
 * tomorrow and finding the library still showing "Runs, last 30 days, shared
 * only" — with no memory of setting it — reads as data loss rather than as a
 * setting being honoured. A session is the right lifetime, and it is the one
 * lifetime that needs no expiry logic of our own.
 *
 * Unlike useLocalStorage there is no cross-instance sync: this is one page's
 * working state, and two copies of it are not a thing that happens.
 */
export function useSessionState<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(key)
      // Spread over the default so a stored shape from an older build — missing
      // a field added since — cannot leave the caller with undefined where it
      // expects a value.
      return raw != null ? { ...initial, ...(JSON.parse(raw) as object) } as T : initial
    } catch {
      return initial
    }
  })

  const set = useCallback((v: T | ((prev: T) => T)) => {
    setValue(prev => {
      const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v
      try {
        sessionStorage.setItem(key, JSON.stringify(next))
      } catch {
        /* storage full or unavailable — keep the in-memory value */
      }
      return next
    })
  }, [key])

  return [value, set]
}
