import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, ApiError, type ApiUser, type AuthFeatures } from '../lib/api'
import { clearApiCache } from '../lib/swCache'
import { isGatewayError } from '../lib/network'
import { isNative, setAuthToken } from '../lib/serverConfig'

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

/**
 * The last user the server confirmed, kept so a cold start with the backend
 * unreachable opens the app instead of the login screen.
 *
 * This is a UI convenience, not a credential: every request still carries the
 * session cookie and the server still decides. The worst case is that an
 * offline app shows its shell and cached data to someone whose session has
 * since expired, and every action they attempt fails once the network returns.
 */
const CACHED_USER_KEY = 'auth.user'

function readCachedUser(): ApiUser | null {
  try {
    const raw = localStorage.getItem(CACHED_USER_KEY)
    return raw ? JSON.parse(raw) as ApiUser : null
  } catch {
    return null
  }
}

function writeCachedUser(u: ApiUser | null): void {
  try {
    if (u) localStorage.setItem(CACHED_USER_KEY, JSON.stringify(u))
    else localStorage.removeItem(CACHED_USER_KEY)
  } catch {
    // Private mode, or storage full — the app works, it just cannot resume
    // offline.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<ApiUser | null>(null)
  const [features, setFeatures] = useState<AuthFeatures | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const { user } = await api.me()
      setUserState(user)
      writeCachedUser(user)
    } catch (err) {
      // Only the app itself gets to say you are signed out. A 401 is that
      // verdict; a gateway error is a proxy reporting it could not reach the
      // app at all, which is an outage and must be handled like a dropped
      // connection — otherwise being offline logs you out.
      if (err instanceof ApiError && !isGatewayError(err.status)) {
        if (err.status === 401) {
          setUserState(null)
          writeCachedUser(null)
        }
        return
      }
      const cached = readCachedUser()
      if (cached) {
        setUserState(cached)
        return
      }
      throw err
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
    // The native app cannot use cookies across origins, so it asks for the
    // session token in the body and holds it itself. Everything after this
    // point is identical: api.ts attaches the token the same way the browser
    // attaches the cookie, and no other caller knows which happened.
    if (isNative()) {
      const { token, user } = await api.tokenLogin(identifier, password)
      await setAuthToken(token)
      setUserState(user)
      writeCachedUser(user)
      return
    }
    const { user } = await api.login(identifier, password)
    setUserState(user)
    writeCachedUser(user)
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
      // Dropped even if the request failed: the point of signing out is that
      // this device stops holding a credential, and a server that could not be
      // reached is the case where that matters most. The session stays alive
      // server-side until it expires or is revoked from another device.
      await setAuthToken(null)
      setUserState(null)
      // The cached identity is this user's too, so it goes with the rest.
      writeCachedUser(null)
      // The service worker caches API GETs so the app works offline. Those
      // responses are this user's data, so drop them on the way out rather
      // than leaving them readable to whoever logs in next on this device.
      void clearApiCache()
    }
  }, [])

  const setUser = useCallback((u: ApiUser) => { setUserState(u); writeCachedUser(u) }, [])

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
