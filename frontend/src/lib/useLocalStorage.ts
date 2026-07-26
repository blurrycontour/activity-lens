import { useCallback, useEffect, useState } from 'react'

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

  const set = useCallback((v: T | ((prev: T) => T)) => {
    setValue(prev => {
      const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v
      try {
        localStorage.setItem(key, JSON.stringify(next))
        window.dispatchEvent(new CustomEvent('al-localstorage', { detail: key }))
      } catch {
        /* storage full or unavailable — keep in-memory value */
      }
      return next
    })
  }, [key])

  useEffect(() => {
    function sync(e: Event) {
      if (e instanceof StorageEvent && e.key !== null && e.key !== key) return
      if (e instanceof CustomEvent && e.detail !== key) return
      setValue(read())
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
