# Activity Lens for Android

A [Capacitor](https://capacitorjs.com) shell around the web app in `../frontend`.
It bundles the same production build the PWA ships, so there is one app, one
codebase, and one set of bugs — the Android project adds a container and a
first-run screen for choosing a server, nothing else.

The APK contains **no server address**. One build works against anyone's
instance; the address is asked for at first launch and stored on the device.

## Building an APK

### With Docker — nothing else installed

```sh
scripts/build-apk.sh          # debug
scripts/build-apk.sh release  # release (unsigned unless a keystore is supplied)
```

The APK lands in `mobile/dist/`. The first run downloads the Android SDK into a
container image and takes a few minutes; after that the toolchain and the Gradle
cache are reused.

### With a local Android SDK

If you already have one (Android Studio, say), skip the container:

```sh
scripts/apk.sh debug
```

Both paths run the *same* script — `scripts/build-apk.sh` only supplies a
toolchain for `scripts/apk.sh` to run in. CI runs it too, so a build cannot pass
locally and fail there for reasons of its own.

### Installing it

```sh
adb install -r mobile/dist/activity-lens-*.apk
```

or download it from the login page of a server built with it.

> [!TIP]
> **Build a release APK, not a debug one, for a phone you actually use.**
>
> A debug APK is signed with a generated key and marked `android:debuggable`, and
> Play Protect blocks that combination outright — "unsafe app blocked", with
> "install anyway" hidden behind a More details link, on every install and every
> update. A release APK signed with your own key gets the ordinary sideloading
> prompt and nothing further.
>
> Set `AL_KEYSTORE` in `.env.build` and `scripts/deploy.sh` builds release
> automatically. Debug builds remain useful for a quick check on a spare device.

### Signing a release

Create a keystore once, and keep it somewhere safe — losing it means no future
build can upgrade an installed app, only replace it:

```sh
keytool -genkeypair -v \
        -keystore release.p12 -storetype PKCS12 \
        -keyalg RSA -keysize 4096 -sigalg SHA256withRSA \
        -validity 10000 -alias activity-lens
```

PKCS#12 rather than JKS: it is the standard, interoperable format and what
`keytool` has defaulted to since JDK 9 — JKS is the proprietary predecessor and
is deprecated. 4096-bit RSA because this key has to outlive the app: the validity
above is 27 years, and it cannot be rotated without every user reinstalling.

A `.jks` is still accepted; the build picks the store type from the extension.

Then:

```sh
AL_KEYSTORE=/path/to/release.p12 \
AL_KEYSTORE_PASSWORD=… AL_KEY_ALIAS=activity-lens AL_KEY_PASSWORD=… \
scripts/build-apk.sh release
```

In CI the same four values come from the repository secrets
`ANDROID_KEYSTORE_BASE64` (`base64 -w0 release.p12`),
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`.
Without them a release build still succeeds and produces an unsigned APK.

Version name and code default to `git describe` and the commit count; override
with `AL_VERSION` / `AL_VERSION_CODE`.

## How it fits together

```
frontend/          the app. `pnpm build` -> frontend/dist
mobile/
  capacitor.config.ts   points webDir at ../frontend/dist
  package.json          Capacitor CLI + the native half of each plugin
  android/              the generated Android project (committed)
  scripts/              build-time guards
```

Two `package.json` files exist because every Capacitor plugin is two halves: the
JavaScript that Vite bundles from `frontend/node_modules`, and the Java that
Gradle compiles from `mobile/node_modules`. They must be the same version, so
both files pin `@capacitor/core` and `@capacitor/preferences` **exactly** and
`scripts/check-versions.mjs` fails the build if they drift. Dependabot updates
them as one group for the same reason.

`android/` is committed rather than generated on demand. `npx cap add android`
copies a template that changes between Capacitor releases, so generating it in CI
would mean the APK quietly changing without a commit saying so.

## Changes to the generated Android project

Everything in `android/` came from `npx cap add android` except the following.
Capacitor never overwrites these files, but an upgrade may change what its
template would produce — this list is what to re-apply if the project is ever
regenerated.

| File | Change | Why |
|---|---|---|
| `app/src/main/AndroidManifest.xml` | `android:usesCleartextTraffic="true"` | A self-hosted instance on a LAN is often plain http. Blocking it would fail a very normal setup; the address is one the user chose. |
| `app/src/main/AndroidManifest.xml` | `android:allowBackup="false"` | The session token lives in app-private storage. Android's auto-backup would copy it to the user's Google Drive. |
| `app/build.gradle` | version from `alVersionName` / `alVersionCode` properties | So releasing does not mean editing a file, and CI can set both. |
| `app/build.gradle` | release `signingConfig`, active only when `alKeystore` is supplied | Keeps signing material out of the repo, and lets an unsigned release build succeed. |
| `app/src/main/res/` | every generated PNG deleted; the icon and splash are vectors (`drawable/ic_launcher_foreground.xml`, `drawable/splash.xml`, `values/colors.xml`) | Otherwise the app ships Capacitor's placeholder icon, and 26 committed PNGs that can drift from the web icons. |
| `variables.gradle` | `minSdkVersion` 24 → 26 | Adaptive icons need API 26. Android 8.0 is 2017, so this is the last ~1% of devices. |
| `values/styles.xml` | `AppTheme.NoActionBar` sets window, status-bar and navigation-bar colours | Capacitor's own version inherits AppCompat's defaults, which show as grey bars above and below the WebView. |
| `java/.../SystemBarsPlugin.java` | new | Follows the in-app light/dark toggle at runtime, the native equivalent of the `theme-color` meta tag. |
| `java/.../AppUpdatePlugin.java` | new | In-app update: streams the APK into a `PackageInstaller` session with progress. |
| `java/.../MainActivity.java` | registers both plugins | Plugins in this module are not auto-discovered the way npm ones are. |
| `AndroidManifest.xml` | `REQUEST_INSTALL_PACKAGES` | Needed to install an update. The user must still grant "install unknown apps" and confirm each install. |

## Distribution and updating

**The server image carries the APK.** `scripts/apk.sh` writes it to
`mobile/dist/`, and the Dockerfile's `androidapp` stage copies it to
`/app/android/` inside the image alongside an `apk.json` describing it.

1. `GET /api/app/android` reports the bundled app: version, size, checksum.
2. The Android app compares that to its own version and offers the update.
3. `GET /api/app/android/download` serves the file — with range support, so an
   interrupted download on a phone resumes instead of restarting.

Two things follow from bundling, and both are the point:

- **A client can never run ahead of its server.** The APK was built from the same
  commit, so upgrading the server is what offers users a new app. There is no
  second source that could be newer.
- **Nothing external is needed.** No GitHub, no internet beyond your own server —
  which is what a self-hosted app should require.

It costs ~4 MB of image size. An image built with an empty `mobile/dist/` simply
carries no app and reports `available: false`; there is deliberately no fallback
to somewhere else, because a second source is exactly what reintroduces version
drift and signing-key mismatches. `AL_ANDROID_APP=false` turns the whole thing
off at runtime.

In CI the APK is built **once** (`.github/workflows/android.yml`) and consumed
by both the image build and the GitHub release, each of which re-checks its
SHA-256 against what the build job recorded. The bytes in the image and the bytes
on the releases page are identical by construction, and verified besides.

> [!IMPORTANT]
> **Android refuses to replace an app with one signed by a different key** — the
> install fails with "signatures do not match", and the only way out is to
> uninstall first.
>
> The default debug key is generated per machine, and inside the build container
> that means per volume, so two debug APKs are not reliably interchangeable
> either. To test the in-app updater, put a keystore in `.env.build`: both build
> types are then signed with it, every APK from this repository shares one
> identity, and updates work end to end. See "Signing a release" above.
>
> Tagged CI builds produce a signed release APK; everything else produces a debug
> APK. Whichever you install first commits you to its signing key.

## What the native app does differently

Two things, both isolated in `frontend/src/lib/serverConfig.ts`:

- **The API lives somewhere else.** Every request is prefixed with the configured
  server. On web that prefix is empty and requests stay same-origin.
- **It authenticates with a bearer token, not a cookie.** The WebView is its own
  origin, so a session cookie could not be sent. `POST /api/auth/token` returns
  the same session token a cookie would have carried — it is one session, listed
  and revocable in Settings → Sessions like any other device.

### The WebView's origin

The app serves itself from `https://activity-lens.localhost`, not Capacitor's
default `https://localhost`.

Password managers key saved credentials on the origin, and on plain `localhost`
the app shares one with every other localhost thing the user has ever signed in
to — so the picker offers all of them, and saving a new password adds to that
pile. A host of its own gives the app a normal, private entry.

It stays on `https` rather than a custom `activity-lens://` scheme, which would
be the obvious way to get a distinct origin. A non-standard scheme is not a
secure context, and `crypto.subtle` — which does the content hashing that import
dedupe is built on — does not exist outside one. The app would install and then
fail to import a file. `.localhost` is reserved by RFC 6761, never resolves, and
is treated as a secure context, so it gets the distinct origin with none of that.

The backend's CORS allowlist (`backend/internal/httpapi/cors.go`) has to name the
same host. A mismatch shows up as every request from the app failing CORS.

### System bars

The app draws edge to edge. The WebView fills the screen including the space
behind the status and navigation bars; the bars themselves are transparent, and
the page pads its own chrome clear of them with `env(safe-area-inset-*)` — which
needs `viewport-fit=cover` on the viewport meta tag to report anything but zero.

This is not a style choice. From Android 15 an app targeting API 35+ is
edge-to-edge whether it asks or not, and `setStatusBarColor` is ignored, so
painting the bars natively cannot work. Letting the page paint that area is also
what makes the bars follow the in-app light/dark toggle for free.

`SystemBarsPlugin` is left with the two things the page cannot say: whether the
bar icons should be light or dark, and what colour the window behind the WebView
is for the moment before the page paints.

The server needs `AL_CORS_ORIGINS` set only if you also use the web app from a
different origin; the WebView's own origin is allowed out of the box. See
`docs/configuration.md`.

There is **no service worker** on native (`main.tsx` skips registration). The
assets it would cache already ship in the APK, and a worker that outlived an app
update could serve the previous build's HTML with no way to clear it. The APK is
the update mechanism, and there should only be one.

### Push notifications, without Google

The web app enrols through the browser's push service. The app cannot: that
service is Firebase Cloud Messaging, it is part of Google Play Services, and on
GrapheneOS or any other de-Googled Android it is not there. So the app speaks
**UnifiedPush** instead.

UnifiedPush is a protocol, not a service. Another app on the phone — a
*distributor*, in practice [ntfy](https://ntfy.sh) — hands out a push URL, and
the server POSTs notifications to it. The distributor holds the one long-lived
connection that every app then shares, which is what makes this cheap on battery
and what FCM does on a stock phone.

Three files implement it, split by lifetime rather than by topic:

| File | Runs when |
|---|---|
| `UnifiedPush.java` | the protocol itself: discovery, the four broadcasts, persisted token and endpoint |
| `UnifiedPushReceiver.java` | with nothing else of the app alive — draws the notification |
| `UnifiedPushPlugin.java` | while the user is in Settings — the bridge to the web app |

**Requirements on the phone.** A distributor app has to be installed; the app
does not bundle one and Settings says so plainly when none is found. The
`<queries>` element in `AndroidManifest.xml` is what makes distributors visible
at all — without it, Android 11+ hides them and push looks unavailable on every
modern phone. `POST_NOTIFICATIONS` is requested when the user enables push, not
at launch.

**The payload carries the notification text.** The message the server sends is
the same JSON the web service worker receives — title, one line of body, and the
in-app link — so the receiver draws it directly, with no network call, no token
handling and nothing to fail while the app is closed.

That means **the distributor can read the notification's title and text**. With
your own ntfy server that is the same trust boundary as the server itself, which
is the deployment this is built for. The alternative — a content-free ping
followed by an authenticated fetch — would keep the text private at the cost of
reproducing the app's auth inside a BroadcastReceiver, and would show nothing at
all whenever the server was briefly unreachable. If you ever point this at a
public distributor, that is the trade you are making. Nothing beyond the
notification is ever sent: no workout data, and nothing the user did not already
choose to be notified about.

**It is drawn to match the web app.** The payload's `icon` — the sender's avatar
for a shared workout, empty for a system event — is the same field the service
worker hands to `showNotification`, so both platforms show the same picture from
one server-side decision. `NotificationImages` fetches it, crops it to a circle
and sets it as the large icon; the app mark stays as the small icon, tinted with
the accent.

Two details that are not obvious:

- **The notification is posted twice** when there is an avatar — immediately, then
  again with the picture. A BroadcastReceiver has about ten seconds to live, so
  waiting on the network before showing anything would delay every share
  notification and lose it outright when the server is unreachable. The second
  post updates the banner in place with `setOnlyAlertOnce`, so the phone buzzes
  once.
- **The circle is cropped here, not by Android**, which clips large icons to a
  circle from Android 12 and shows them square before that. The web app's avatars
  are round everywhere, so doing it ourselves is what makes the notification match
  on every phone rather than on recent ones.

Avatar routes are unauthenticated by design — `handleAutoAvatar` in `account.go`
says so — because an OS notification fetches them from outside any session, on
web and here alike. The receiver has no token and needs none. It does need the
server address, which it reads back out of the Capacitor Preferences store the
web app wrote it to; a failed lookup costs the avatar and nothing else.

The accent tint is the default green from `colors.xml`, not the user's chosen
accent: the notification is built with no WebView running, and the accent lives in
the web app's local storage.

**Reading in the app clears the banner.** `dismissOSNotification` cancels the
tray notification by the id it was tagged with. On web the service worker does
it; the app has no service worker, so `lib/push.ts` routes the same call to the
plugin instead. The tag and the numeric id have to match what the receiver posted
with — hence `UnifiedPushReceiver.NOTIFICATION_ID` rather than a literal at each
call site.

**Endpoints drift, so they are re-sent.** A distributor can issue a new endpoint
while the app is closed, and the broadcast announcing it reaches a receiver with
no WebView to tell. `syncNativePush()` re-registers whatever the phone holds on
every launch; it is an upsert keyed on the endpoint, so doing it unconditionally
beats trying to detect the mismatch.

Server side: `POST /api/push/unifiedpush` stores the endpoint in the same
`push_subscriptions` table as Web Push, distinguished by a `kind` column, so
fan-out, per-kind preferences and account deletion all work unchanged. VAPID keys
are a Web Push concern and are **not** required for any of this — a server with
push otherwise unconfigured still reaches phones.

## Not here yet

Folder watching, share-sheet and "open with" intents are the next round. The
import pipeline they need — content-hash dedupe via `/api/workouts/import/known`
— already exists and is what makes a repeated folder scan cheap.
