import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { RefreshProvider } from './context/RefreshContext'
import './index.css'

// Registering the worker is what makes the app installable, gives it an offline
// shell, and lets it receive files from the Android share sheet. `immediate`
// activates a new worker as soon as it is ready; the app is a read-mostly
// dashboard, so silently taking the latest version is preferable to prompting.
registerSW({ immediate: true })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <RefreshProvider>
        <App />
      </RefreshProvider>
    </AuthProvider>
  </React.StrictMode>,
)
