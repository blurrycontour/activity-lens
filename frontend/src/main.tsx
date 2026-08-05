import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import Root from './Root'
import { isNative, loadServerConfig } from './lib/serverConfig'
import { trackSafeAreaInsets } from './lib/native/systemBars'
import { markUpdateReady, setApplyUpdate } from './lib/appUpdate'
import { installDebugLog } from './lib/debugLog'
// Before ./index.css, and here rather than beside the map it belongs to.
//
// Several rules in index.css override MapLibre's defaults, and they are written
// as single class selectors that tie with MapLibre's own — so which one wins is
// decided purely by stylesheet order. While this was bundled into one
// stylesheet that was stable. Splitting the map into a lazy chunk made its CSS
// a second stylesheet injected at runtime, landing *after* ours, and
// `.maplibregl-map{position:relative}` began beating
// `.route-map-canvas{position:absolute;inset:0}`. The container collapsed to
// zero height: no error anywhere, tiles still fetched, and a blank map.
//
// Loading it eagerly costs ~12kB gzipped and restores the order every one of
// those overrides was written for. The 900kB of MapLibre *JavaScript* is what
// the split was for, and that stays lazy.
import 'maplibre-gl/dist/maplibre-gl.css'
import './index.css'

// Before anything else runs, so a failure during startup — the most interesting
// kind — is in the buffer a feedback report can attach. Records only; nothing
// leaves the device unless the user asks it to.
installDebugLog()

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

  // The Android app draws behind the system bars, so the page has to know how
  // much room they take before it lays anything out. A no-op on web.
  void trackSafeAreaInsets()

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>,
  )
})
