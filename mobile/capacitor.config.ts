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
  appId: 'io.blurrycontour.activitylens',
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
    // https rather than a custom activity-lens:// scheme, even though a custom
    // scheme is the obvious way to get a distinct origin. A non-standard scheme
    // is not a secure context, and this app needs one: crypto.subtle does the
    // content hashing that import dedupe is built on, and it does not exist
    // outside a secure context. The app would install and then fail to import a
    // file, which is worse than the problem being solved.
    androidScheme: 'https',

    // A hostname of our own instead of the default `localhost`.
    //
    // Password managers key saved credentials on the origin. On
    // https://localhost the app shares an origin with every other localhost
    // thing the user has ever signed in to, so the picker offers all of them and
    // saving a new one adds to that pile. A distinct host gives the app its own
    // entry that fills and saves like any normal site.
    //
    // .localhost is reserved by RFC 6761 and never resolves, so this can never
    // collide with a real site someone registers later, and browsers treat it as
    // a secure context exactly like localhost itself. Anything under a real TLD
    // would be a name we do not own.
    hostname: 'activity-lens.localhost',
  },
}

export default config
