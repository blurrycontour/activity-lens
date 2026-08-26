import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * useLocalStorage persists a piece of state to localStorage under `key`,
 * keeping it in sync across component instances (and other tabs) via the
 * `storage` event and a same-tab custom event. JSON is used for (de)serializing
 * so any serializable value works.
 */
export function useLocalStorage<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const read = useCallback((): T => {
    try {
      const raw = localStorage.getItem(key)
      return raw != null ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  }, [key, initial])

  const [value, setValue] = useState<T>(read)

  /*
   * The newest value, so `set` can resolve a functional update without doing
   * it inside the state updater.
   *
   * It used to write to storage and dispatch the sync event from in there, and
   * a state updater has to be pure — React is free to call it more than once,
   * and does in development. With a *value* that is harmless, which is why
   * every toggle in the app looked fine; with a *function* it is not, because
   * the second call could see the first call's own result. `toggleMetric` is
   * "in the list? drop it : add it", so it ran twice and put the list back
   * exactly as it was: tapping a measure on the Trends tab did nothing at all
   * under `pnpm dev`. It worked in a production build, which is the worst
   * possible shape for a bug — it makes the development build lie about the
   * app.
   *
   * Assigned during render, which is the standard latest-ref pattern, and kept
   * in step by `set` and by the sync listener so two calls in one tick still
   * compose.
   */
  const latest = useRef(value)
  latest.current = value

  const set = useCallback((v: T | ((prev: T) => T)) => {
    const next = typeof v === 'function' ? (v as (p: T) => T)(latest.current) : v
    latest.current = next
    try {
      localStorage.setItem(key, JSON.stringify(next))
      window.dispatchEvent(new CustomEvent('al-localstorage', { detail: key }))
    } catch {
      /* storage full or unavailable — keep in-memory value */
    }
    setValue(next)
  }, [key])

  useEffect(() => {
    function sync(e: Event) {
      if (e instanceof StorageEvent && e.key !== null && e.key !== key) return
      if (e instanceof CustomEvent && e.detail !== key) return
      const fresh = read()
      latest.current = fresh
      setValue(fresh)
    }
    window.addEventListener('storage', sync)
    window.addEventListener('al-localstorage', sync as EventListener)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener('al-localstorage', sync as EventListener)
    }
  }, [key, read])

  return [value, set]
}
