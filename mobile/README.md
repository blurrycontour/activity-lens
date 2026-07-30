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
adb install -r mobile/dist/activity-lens-*-debug.apk
```

A debug APK installs on any phone with developer options enabled and needs no
signing material. It is the right thing for your own use.

### Signing a release

Create a keystore once, and keep it somewhere safe — losing it means no future
build can upgrade an installed app, only replace it:

```sh
keytool -genkey -v -keystore release.jks -keyalg RSA -keysize 2048 \
        -validity 10000 -alias activity-lens
```

Then:

```sh
AL_KEYSTORE=/path/to/release.jks \
AL_KEYSTORE_PASSWORD=… AL_KEY_ALIAS=activity-lens AL_KEY_PASSWORD=… \
scripts/build-apk.sh release
```

In CI the same four values come from the repository secrets
`ANDROID_KEYSTORE_BASE64` (`base64 -w0 release.jks`),
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
> Android refuses to replace an app with one signed by a different key. Tagged CI
> builds produce a signed release APK; everything else produces a debug APK, and
> the two cannot update to one another. An image built from `main` or locally
> bundles a debug APK, so a phone running it can only update to other such
> builds. Whichever APK you install first commits you to its signing key.

## What the native app does differently

Only two things, both isolated in `frontend/src/lib/serverConfig.ts`:

- **The API lives somewhere else.** Every request is prefixed with the configured
  server. On web that prefix is empty and requests stay same-origin.
- **It authenticates with a bearer token, not a cookie.** The WebView is its own
  origin, so a session cookie could not be sent. `POST /api/auth/token` returns
  the same session token a cookie would have carried — it is one session, listed
  and revocable in Settings → Sessions like any other device.

The server needs `AL_CORS_ORIGINS` set only if you also use the web app from a
different origin; the WebView's own origin is allowed out of the box. See
`docs/configuration.md`.

There is **no service worker** on native (`main.tsx` skips registration). The
assets it would cache already ship in the APK, and a worker that outlived an app
update could serve the previous build's HTML with no way to clear it. The APK is
the update mechanism, and there should only be one.

## Not here yet

Folder watching, share-sheet and "open with" intents are the next round. The
import pipeline they need — content-hash dedupe via `/api/workouts/import/known`
— already exists and is what makes a repeated folder scan cheap.
