import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { RefreshProvider } from './context/RefreshContext'
import { startNetworkMonitor } from './lib/network'
import { markUpdateReady, setApplyUpdate } from './lib/appUpdate'
import './index.css'

// Registering the worker is what makes the app installable, gives it an offline
// shell, and lets it receive files from the Android share sheet.
//
// A new build is offered rather than applied: taking it silently means reloading
// the page underneath whatever the user is doing, which can throw away an
// unsaved note or a half-filled import form. `applyUpdate` is handed to the app
// so the toast can trigger the reload when the user asks for it.
const applyUpdate = registerSW({
  immediate: true,
  onNeedRefresh() {
    markUpdateReady()
  },
})
setApplyUpdate(applyUpdate)

// Poll the backend so losing connectivity is noticed while the user is sitting
// on a page, not only when the next request happens to be made.
startNetworkMonitor()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <RefreshProvider>
        <App />
      </RefreshProvider>
    </AuthProvider>
  </React.StrictMode>,
)
