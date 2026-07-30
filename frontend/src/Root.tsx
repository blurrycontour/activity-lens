import { useEffect, useState } from 'react'
import App from './App'
import ServerSetup from './pages/ServerSetup'
import { AuthProvider } from './context/AuthContext'
import { RefreshProvider } from './context/RefreshContext'
import { startNetworkMonitor } from './lib/network'
import { needsServerConfig, onServerForgotten } from './lib/serverConfig'
import UpdatePrompt from './components/UpdatePrompt'

/**
 * Decides whether the app can start yet.
 *
 * On web it always can: the API is wherever the page came from, so this is a
 * pass-through and `needsServerConfig()` is constant-false. In the Android app
 * there is no server until the user names one, and nothing below this point can
 * work without it — the auth context asks who you are the moment it mounts, and
 * asking a server that does not exist would land on a login screen for nowhere.
 *
 * So the gate is here rather than inside App: the providers are not mounted at
 * all until an address is known and has answered.
 */
export default function Root() {
  const [needsServer, setNeedsServer] = useState(needsServerConfig)

  // Started here rather than at boot because the reachability probe is a
  // request like any other, and there is nowhere to send it until a server is
  // configured. Calling it more than once is a no-op.
  useEffect(() => {
    if (!needsServer) startNetworkMonitor()
  }, [needsServer])

  // "Change server", from the login screen or from Settings. Unmounting the
  // providers is what makes this clean: the auth context, the cached user and
  // every page's state go with them, so nothing from the old server survives
  // into the new one.
  useEffect(() => onServerForgotten(() => setNeedsServer(true)), [])

  if (needsServer) {
    return <ServerSetup onConfigured={() => setNeedsServer(false)} />
  }

  return (
    <AuthProvider>
      <RefreshProvider>
        {/* Above the auth boundary on purpose: an update is about the app, not
            about who is signed in, and the login screen is exactly where
            someone stuck on an old build is most likely to be sitting. */}
        <UpdatePrompt />
        <App />
      </RefreshProvider>
    </AuthProvider>
  )
}
