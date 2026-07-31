import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { api, type UserPreferences } from '../lib/api'

interface PreferencesValue {
  prefs: UserPreferences | null
  loading: boolean
  /**
   * Merges `patch` into the current preferences and saves the whole object.
   * Applies the change immediately and rolls it back if the save fails, so a
   * switch never sits in a state the server disagrees with. Throws on failure.
   */
  save: (patch: Partial<UserPreferences>) => Promise<void>
}

const Ctx = createContext<PreferencesValue | null>(null)

/**
 * Loads the user's preferences once and saves them as a whole.
 *
 * `PUT /api/preferences` replaces the entire record — it has no notion of a
 * partial update. That was harmless while a single page owned every field, but
 * the settings categories are separate pages now, and a page sending only its
 * own fields would silently wipe the others (save your max HR, lose your
 * goals). Routing every write through here means a patch is always merged into
 * the full object first, so that cannot happen.
 */
export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefsState] = useState<UserPreferences | null>(null)
  const [loading, setLoading] = useState(true)
  // Mirrors `prefs` so save() can read the current value without closing over
  // a stale render, and without depending on when React flushes an update.
  const prefsRef = useRef<UserPreferences | null>(null)

  const setPrefs = useCallback((p: UserPreferences | null) => {
    prefsRef.current = p
    setPrefsState(p)
  }, [])

  useEffect(() => {
    let alive = true
    api.getPreferences()
      .then(p => { if (alive) setPrefs(p) })
      .catch(() => { /* leave null; pages fall back to their defaults */ })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [setPrefs])

  const save = useCallback(async (patch: Partial<UserPreferences>) => {
    const current = prefsRef.current
    if (!current) throw new Error('Preferences are still loading')
    const merged = { ...current, ...patch }
    setPrefs(merged)
    try {
      setPrefs(await api.savePreferences(merged))
    } catch (err) {
      setPrefs(current)
      throw err
    }
  }, [setPrefs])

  const value = useMemo(() => ({ prefs, loading, save }), [prefs, loading, save])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePreferences(): PreferencesValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('usePreferences must be used inside PreferencesProvider')
  return v
}
