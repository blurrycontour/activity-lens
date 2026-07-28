import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from '../lib/api'
import { useRefreshHandler } from './RefreshContext'
import { type Workout } from '../data/workouts'

interface WorkoutsState {
  workouts: Workout[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  removeWorkout: (id: string) => Promise<void>
  updateWorkout: (id: string, patch: { name?: string; type?: string; notes?: string; date?: string; calories?: number; steps?: number; equipmentIds?: string[] }) => Promise<Workout>
}

const WorkoutsContext = createContext<WorkoutsState | null>(null)

export function WorkoutsProvider({ children }: { children: ReactNode }) {
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    // Deliberately does not re-raise `loading`: this runs for pull-to-refresh
    // and after an import, where replacing the page with a spinner would be a
    // worse experience than briefly showing slightly stale rows. `loading` is
    // therefore only ever true for the very first load.
    setError(null)
    try {
      const data = await api.listWorkouts()
      setWorkouts(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load workouts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Most pages render this cache, so pulling to refresh should reload it.
  useRefreshHandler(refresh)

  const removeWorkout = useCallback(async (id: string) => {
    await api.deleteWorkout(id)
    setWorkouts(prev => prev.filter(w => w.id !== id))
  }, [])

  const updateWorkout = useCallback(
    async (id: string, patch: { name?: string; type?: string; notes?: string; date?: string; calories?: number; steps?: number; equipmentIds?: string[] }) => {
      const updated = await api.patchWorkout(id, patch)
      setWorkouts(prev => prev.map(w => (w.id === id ? updated : w)))
      return updated
    },
    [],
  )

  return (
    <WorkoutsContext.Provider value={{ workouts, loading, error, refresh, removeWorkout, updateWorkout }}>
      {children}
    </WorkoutsContext.Provider>
  )
}

export function useWorkouts(): WorkoutsState {
  const ctx = useContext(WorkoutsContext)
  if (!ctx) throw new Error('useWorkouts must be used within WorkoutsProvider')
  return ctx
}
