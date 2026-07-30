import type { CapacitorConfig } from '@capacitor/cli'

/**
 * The Android shell around the Activity Lens web app.
 *
 * The web assets are not built here: `webDir` points at the frontend's normal
 * production build, so the APK ships byte-identical code to the PWA and there is
 * only ever one app to reason about. `cap sync` copies that directory into the
 * Android project; nothing in mobile/ compiles TypeScript.
 *
 * No server URL appears anywhere in this file, on purpose. One APK works against
 * anyone's instance, and the address is asked for at first launch.
 */
const config: CapacitorConfig = {
  appId: 'io.github.blurrycontour.activitylens',
  appName: 'Activity Lens',
  webDir: '../frontend/dist',

  android: {
    // The app's own pages are served from https://localhost inside the WebView.
    // A self-hosted instance reached over plain http on a LAN would otherwise be
    // blocked as mixed content — which is a very normal way to run this app, and
    // failing that case would be worse than the exposure. The address is one the
    // user typed and it is theirs; over the internet they should use https, and
    // the setup screen assumes https when the scheme is left off.
    allowMixedContent: true,
  },

  server: {
    // https rather than the legacy capacitor:// scheme. It keeps the WebView in
    // a secure context, which is what crypto.subtle needs — import hashing uses
    // it, so this is load-bearing, not cosmetic.
    androidScheme: 'https',
  },
}

export default config
