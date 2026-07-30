import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import Root from './Root'
import { isNative, loadServerConfig } from './lib/serverConfig'
import { markUpdateReady, setApplyUpdate } from './lib/appUpdate'
import './index.css'

// Registering the worker is what makes the app installable, gives it an offline
// shell, and lets it receive files from the Android share sheet.
//
// A new build is offered rather than applied: taking it silently means reloading
// the page underneath whatever the user is doing, which can throw away an
// unsaved note or a half-filled import form. `applyUpdate` is handed to the app
// so the toast can trigger the reload when the user asks for it.
//
// Deliberately skipped in the Android app. Everything the worker offers there is
// either redundant or actively harmful: the assets it would precache already
// ship inside the APK, the share target is replaced by Android's own intents,
// and a worker that outlives an app update can keep serving the previous build's
// HTML out of its cache — an offline shell that shadows the installed one, with
// no way for the user to clear it. The APK is the update mechanism on native,
// and there should only ever be one.
function registerServiceWorker() {
  if (isNative()) return
  const applyUpdate = registerSW({
    immediate: true,
    onNeedRefresh() {
      markUpdateReady()
    },
  })
  setApplyUpdate(applyUpdate)
}

// The stored server URL and token have to be in hand before anything asks for
// them: api.ts reads them synchronously on every call, and the auth context
// makes its first call as soon as it mounts. Loading first and rendering after
// is what keeps that read synchronous everywhere else.
void loadServerConfig().then(() => {
  registerServiceWorker()

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>,
  )
})
