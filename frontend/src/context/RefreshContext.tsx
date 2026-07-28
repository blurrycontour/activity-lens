import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

// Coordinates "reload the data on screen" without reloading the page.
//
// Pull-to-refresh has to refresh whatever the current page is showing, but each
// page owns its own data: most read the shared workout cache, while Equipment
// and Admin fetch their own. Rather than teach the gesture about every page,
// pages register a loader here and the gesture just runs all of them.

type Loader = () => Promise<unknown> | unknown

interface RefreshState {
  /** True while a refresh is in flight, so the UI can show a spinner. */
  refreshing: boolean
  /** Runs every registered loader. Resolves when they have all settled. */
  refresh: () => Promise<void>
  /** Registers a loader for as long as the caller is mounted. */
  register: (fn: Loader) => () => void
}

const RefreshContext = createContext<RefreshState | null>(null)

export function RefreshProvider({ children }: { children: ReactNode }) {
  const [refreshing, setRefreshing] = useState(false)
  // A ref, not state: registering a loader must not re-render the tree, and the
  // set is only ever read at refresh time.
  const loaders = useRef(new Set<Loader>())

  const register = useCallback((fn: Loader) => {
    loaders.current.add(fn)
    return () => {
      loaders.current.delete(fn)
    }
  }, [])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      // allSettled, not all: one failing page must not abort the others, and
      // each page already surfaces its own error state.
      await Promise.allSettled([...loaders.current].map(fn => fn()))
    } finally {
      setRefreshing(false)
    }
  }, [])

  return (
    <RefreshContext.Provider value={{ refreshing, refresh, register }}>
      {children}
    </RefreshContext.Provider>
  )
}

export function useRefresh(): RefreshState {
  const ctx = useContext(RefreshContext)
  if (!ctx) throw new Error('useRefresh must be used within RefreshProvider')
  return ctx
}

/**
 * Registers `load` to run when the user pulls to refresh, for as long as the
 * calling component is mounted.
 *
 * Pass a stable callback (useCallback), otherwise the loader is swapped on
 * every render — harmless but pointless churn.
 */
export function useRefreshHandler(load: Loader): void {
  const { register } = useRefresh()
  useEffect(() => register(load), [register, load])
}
