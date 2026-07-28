import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, ApiError, type ApiUser, type AuthFeatures } from '../lib/api'
import { clearApiCache } from '../lib/swCache'

interface AuthState {
  user: ApiUser | null
  features: AuthFeatures | null
  loading: boolean
  login: (identifier: string, password: string) => Promise<void>
  register: (payload: { username: string; email: string; displayName: string; password: string }) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
  setUser: (u: ApiUser) => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<ApiUser | null>(null)
  const [features, setFeatures] = useState<AuthFeatures | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const { user } = await api.me()
      setUserState(user)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUserState(null)
      } else {
        throw err
      }
    }
  }, [])

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const [feat] = await Promise.all([api.authConfig()])
        if (active) setFeatures(feat)
      } catch {
        // features are best-effort
      }
      try {
        await refresh()
      } catch {
        // ignore; treated as logged out
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [refresh])

  const login = useCallback(async (identifier: string, password: string) => {
    const { user } = await api.login(identifier, password)
    setUserState(user)
  }, [])

  const register = useCallback(
    async (payload: { username: string; email: string; displayName: string; password: string }) => {
      const { user } = await api.register(payload)
      setUserState(user)
    },
    [],
  )

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } finally {
      setUserState(null)
      // The service worker caches API GETs so the app works offline. Those
      // responses are this user's data, so drop them on the way out rather
      // than leaving them readable to whoever logs in next on this device.
      void clearApiCache()
    }
  }, [])

  const setUser = useCallback((u: ApiUser) => setUserState(u), [])

  return (
    <AuthContext.Provider value={{ user, features, loading, login, register, logout, refresh, setUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
