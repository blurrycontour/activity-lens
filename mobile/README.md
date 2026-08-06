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

The APK lands in `mobile/dist/`. The first run pulls the toolchain image CI
publishes and takes a couple of minutes; after that the image and the Gradle
cache are reused.

The image is tagged with a hash of `Dockerfile.android`, and CI computes that
same tag, so the toolchain a local build asks for is the one CI already built —
it is pulled rather than rebuilt. That distinction matters more than it looks:
rebuilding from the Dockerfile reproduces the *recipe*, but its base images are
tags rather than digests, so a rebuild months apart can resolve to a different
JDK patch. Pulling gets the bytes. Editing `Dockerfile.android` changes the hash,
finds nothing published, and falls back to building — as does a fork, or a
machine with no network.

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

### Local builds are a separate app

Set `AL_APP_ID_SUFFIX=.dev` in `.env.build` and every APK from your machine
becomes `io.blurrycontour.activitylens.dev`, labelled "Activity Lens Dev".
Android treats it as a different application entirely — own icon, own data, own
place in the launcher — so it installs *alongside* the copy you use every day
rather than replacing it.

The suffix keys off **where** the build happened, not the build type. A release
build signed locally with the real keystore is byte-for-byte the same kind of
artifact as the published one and would silently take over the installed app;
"is this the real thing" is a question about provenance, which only the person
building knows. CI has no `.env.build`, so published APKs never carry it.

The consequence to know: a `.dev` install can never update to the published app.
Android matches applications by id and will not replace one whose id differs —
it installs a second copy — so the published APK is not an update to a `.dev`
build, it is a different app.

The updater therefore does not offer it. `scripts/apk.sh` records the
`applicationId` in `apk.json` (read back out of the built APK with `aapt2`, so
it cannot disagree with what Gradle produced), the server reports it from
`/api/app/android`, and the app compares it with its own package name before
looking at versions at all.

Without that check the two ids differ, the two versions differ, and the app
concludes there is an update — one that installs beside it and changes nothing,
so the prompt returns on the next launch and every launch after. A server whose
`apk.json` predates the field sends no id, which is treated as "assume it fits":
the version comparison alone then decides, exactly as it used to.

CI always builds **release**, tagged or not.

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

`android/` is committed rather than generated on demand. `pnpm exec cap add android`
copies a template that changes between Capacitor releases, so generating it in CI
would mean the APK quietly changing without a commit saying so.

## Changes to the generated Android project

Everything in `android/` came from `pnpm exec cap add android` except the following.
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
| `java/.../MainActivity.java` | registers this module's plugins | Plugins in this module are not auto-discovered the way npm ones are. |
| `AndroidManifest.xml` | `REQUEST_INSTALL_PACKAGES` | Needed to install an update. The user must still grant "install unknown apps" and confirm each install. |
| `AndroidManifest.xml` | `VIEW` intent filter on `${applicationId}://auth` | Where the browser returns a finished SSO sign-in. `${applicationId}` so a local build claims a different scheme than the published app. |
| `java/.../NativeAuthPlugin.java` | new | Opens SSO in a Custom Tab and collects the code the deep link brings back. |
| `AndroidManifest.xml` | `SEND` / `SEND_MULTIPLE` intent filter | Puts the app in the share sheet for workout files. Android does not honour the web manifest's `share_target` for an installed PWA, so without this the APK is the one install that cannot receive a share. |
| `AndroidManifest.xml` | `VIEW` intent filters for `.gpx` / `.tcx` / `.zip` / `.gz` | "Open with" on a workout file, the native equivalent of the manifest's `file_handlers`. Archives match on MIME type; `.gpx` and `.tcx` have none registered on Android and must match on the file name. See below. |
| `java/.../IncomingFiles.java`, `java/.../IncomingFilesPlugin.java` | new | Copies a shared file out of its `content://` URI while the read grant is still valid, and hands the page a path. See below. |

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

`android.yml` has no `push` trigger: `docker.yml` calls it. A workflow that is
both called and independently triggered runs twice on every commit, which is
what produced two identical status checks and two identical APK builds.

The **web bundle** is built once too, by `scripts/apk.sh`, and handed to the
image build as the `frontend-dist` build context — which overrides the stage in
`Dockerfile` that would otherwise build it again. Before that, the image built
the frontend a second time on a different, unpinned Node and pnpm, so the PWA
and the native app were assembled by different toolchains while claiming to ship
the same bundle. A plain `docker build` with no build context still builds it
itself, so the image remains buildable from a clean checkout.

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

A local build (`AL_APP_ID_SUFFIX`) serves itself from
`https://activity-lens-dev.localhost` instead, for the same reason it gets its
own package name: with one host, the password manager sees a single site, offers
the production account when signing in to the dev app, and saving a different one
there competes with the entry for the app actually in use. Any suffix maps to
that one host, so the origin is always one of exactly two known strings — the
server has to allow it by name, and an allowlist that has to guess is not one.

The backend's CORS allowlist (`backend/internal/httpapi/cors.go`) has to name
both hosts. A mismatch shows up as every request from the app failing CORS.

### SSO

The web app signs in with SSO by following a link: the server sets a session
cookie and redirects back. None of that reaches the app. Its WebView is on its
own origin, cookies cannot cross that boundary, and CORS here never sends
`Allow-Credentials` — so following the link natively just handed the user to the
system browser looking at the *server's* copy of the app, signing the browser in
and leaving the app exactly as it was.

So the native flow is the one RFC 8252 prescribes, and it runs like this:

1. the app generates a random **verifier** and sends only its SHA-256 digest, as
   `/api/auth/oidc/login?native=<challenge>&scheme=<application id>`;
2. `NativeAuthPlugin` opens that in a **Custom Tab** — the real browser, which is
   where a provider is willing to render and where the user's existing session
   with it already lives;
3. the server carries the challenge through the flow in a short-lived cookie
   (both hops happen in that same browser, so go-authkit needs no changes) and,
   on success, redirects to `<application id>://auth?code=…`;
4. the app redeems the code **and its verifier** at `/api/auth/oidc/exchange` for
   an ordinary bearer token.

The verifier is the whole point of the last step. Android grants no exclusivity
over a custom scheme, so any installed app can register the same one and receive
whatever the browser sends — the deep link is assumed to be readable by others,
and carries nothing usable without a secret that never left the device. Sending
the token directly would have been half the code and a live session handed to
whoever else was listening.

**The tab closes itself.** The Custom Tab is launched from the activity and into
the *same* task — deliberately not with `FLAG_ACTIVITY_NEW_TASK`, which is what
originally left the browser sitting there after a successful sign-in, showing a
spent OAuth redirect. Stacked on top of `MainActivity`, which is `singleTask`,
the deep link routes through `onNewIntent` and the platform destroys everything
above it in the task. The same mechanism that delivers the code closes the
window it arrived from.

That makes backing out of the tab reachable, so it is handled: the page treats
"became visible with no code waiting" as an abandoned sign-in and stops waiting,
rather than spinning until the five-minute timeout. The deep link is stashed in
`onNewIntent`, which runs before the activity resumes, so a real sign-in is
always already there by then. The conclusion is only drawn after the app has
actually been away — otherwise a momentary loss of focus while the browser is
still opening would cancel a sign-in nobody had started.

Two smaller consequences worth knowing:

- **The identity provider needs no reconfiguration.** Its redirect URI still
  points at this server's `/api/auth/oidc/callback`; only the last hop changes.
- **The browser is not left signed in.** No session cookie is set on the native
  path, so the flow leaves no second copy of the credential behind.

The `scheme` parameter is a redirect target supplied by the client, which is why
the server matches it against an allowlist (`appSchemePattern` in
`backend/internal/httpapi/oidc_native.go`) rather than using it — otherwise it
would be an open redirect with a working sign-in attached.

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

**A tapped notification has exactly one home.** The extras are written to
preferences the moment they arrive — from `MainActivity.onCreate` on a cold
start, from `onNewIntent` otherwise — and `consumeTapLink` is the only way to
take them. The event the plugin emits carries nothing; it just means "come and
look".

That indirection is the fix for a real bug. A tap that starts the app cold
arrives long before there is any JavaScript to hand it to, so an event alone is
delivered to nobody; and `getIntent()` keeps returning the *launch* intent
forever unless `onNewIntent` calls `setIntent`, so polling alone reads a stale
tap. Storing it makes every ordering end in the same place, handled once.

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

### Parity with the PWA

The app is the same web build in a WebView, so most things are identical by
construction. These are the places where they cannot be, and what each one does
instead. Every one of them was a silent failure before it was a feature — worth
reading before adding anything that touches the platform.

| What | Web | App |
|---|---|---|
| Saving a file | `<a download>` + blob URL | `Shell.saveFile` → Downloads folder, with a toast |
| Offline data | service worker caches API GETs | `lib/nativeCache.ts`, same cache and policy |
| Push | Web Push + VAPID | UnifiedPush distributor |
| Clearing a notification | service worker | `UnifiedPush.dismiss` |
| Push while app is open | in-app banner | in-app banner, via the `message` event |
| Tapping a notification | worker posts the id to the page | intent extras, stashed until claimed |
| Back button | browser chrome | an `OnBackPressedCallback` → `webView.goBack()` |
| Soft keyboard | window resizes | WebView padded by the IME inset |
| External links | new tab | Capacitor opens the system browser (nothing to do) |
| Image URLs | same-origin, relative | must go through `apiURL()` |
| A workout shared in | `share_target` → service worker → Cache API | `SEND` intent filter → `IncomingFiles` → cache dir |
| "Open with" a workout | `file_handlers` → `launchQueue` (desktop only) | `VIEW` intent filter → `IncomingFiles` |

That last row is the one that keeps biting. The app's origin is not the server,
so a bare `/api/...` in a `src` resolves to the WebView and 404s. It has been
wrong three times — the notification panel's avatar, the map player's avatar —
and it fails invisibly, as a picture that does not appear. **Every image URL goes
through `apiURL()`**, and `avatarUrl()` in `UserAvatar.tsx` exists so that most
of them do not have to think about it.

A push that lands while the app is on screen becomes an in-app banner instead of
a tray notification, matching the web app — being interrupted by a system
notification for something already visible is noise. The receiver hands it to the
page through the plugin's `message` event, and falls back to drawing the
notification unless **all three** of these hold: the plugin exists, the activity
is in the foreground, and the page has a listener attached. That last condition
is what makes it safe. A push arriving in the moment between the WebView starting
and React subscribing would otherwise be handed to nobody and lost, and a
notification that never appears is a far worse failure than a redundant one.

One behaviour is deliberately *not* matched: **map tiles are not cached.** The
service worker keeps them; the app fetches them each time, so route maps are
blank offline while everything around them works.

**Never handle back by overriding `onBackPressed()`.** The app targets SDK 36,
and from Android 16 predictive back is enabled by default —
`enableOnBackInvokedCallback` went from opt-in to opt-out. Under it the system
never calls `Activity.onBackPressed()`: back becomes an `OnBackInvokedCallback`,
androidx forwards it to the `OnBackPressedDispatcher`, and anything not
registered there is skipped while the activity is finished. An override compiles
without a warning and is simply never called, which is how the first attempt at
this shipped looking correct and quitting to the launcher.

### Receiving a workout file

Two ways in, both of which the web manifest declares and Android ignores for an
installed PWA: `share_target` (another app sending a file) and `file_handlers`
("open with" in a file manager). The shell declares them as real intent filters
instead, and `IncomingFiles.java` turns what arrives into the same `File[]` the
service worker route produces — so both end at the same import modal.

**The bytes are copied the moment the intent arrives**, in `onCreate` or
`onNewIntent`, not when the page asks for them. The read grant on a `content://`
URI lives and dies with the intent that carried it, and on a cold start the
WebView does not exist yet — by the time any JavaScript runs the grant is
usually gone. Copying first is what makes a share that *launches* the app work
at all, which is the common case.

**What crosses the bridge is a path, never the bytes.** The page turns it into a
URL with `Capacitor.convertFileSrc` and `fetch`es it. A Strava export is a zip
that can run to hundreds of megabytes and the app unpacks it client-side; moving
that as a base64 string would cost several times its size in memory on both
sides of the bridge, where this costs none.

**The intent filters are deliberately broad and the name check is strict.**
Exporters routinely share a `.gpx` as `application/octet-stream`, or with no type
at all, so a filter that accepted only the correct MIME types would miss most
real shares. `IncomingFiles.isWorkoutFile` then drops anything whose name is not
`.gpx`, `.tcx`, `.zip` or `.gz`. Being offered a file the app cannot use costs a
message; not being offered one it can costs the feature.

#### Why "open with" needs four filters and ten path patterns

**`.gpx` and `.tcx` are not in Android's `MimeTypeMap`.** Nothing on the platform
will ever hand you `application/gpx+xml`: a file manager asks for the type, gets
null, and sends `application/octet-stream` or `*/*`. Matching those two
extensions on type cannot work, so they match on the file name instead. Archives
are the opposite — `.zip` and `.gz` *are* registered, so they match on type and
need no name pattern at all.

Three things about name matching are easy to get wrong, and all three were:

- **A filter with a path but no `mimeType` only matches an intent that carries no
  type.** Since file managers nearly always set one, such a filter looks correct
  and never fires. Hence `mimeType="*/*"` on the main filter, and a second,
  otherwise identical filter with no type for the intents that genuinely have
  none.
- **`android:host` is required for any path attribute to be read at all.** Without
  it Android ignores `pathPattern` outright. `host="*"` matches any authority.
- **`pathPattern` does not backtrack.** It is `PATTERN_SIMPLE_GLOB`, whose `.*`
  scans to the *first* occurrence of the next literal character and gives up if
  the rest fails to match — so `.*\.gpx` stops at the first dot and fails on
  `2024-03-01.morning.gpx`. The fix is one alternative per dot the name might
  contain, which is where five patterns per extension come from.

What this still does not catch is a `content://` URI whose path is an opaque row
id, such as `content://media/external/file/12345` — there is neither a usable
type nor a name to match. Covering those would mean claiming every
`application/octet-stream` file on the device, which would put Activity Lens in
the "open with" list for every unknown binary. Sharing to the app works
regardless, and is the better route in for anything the file manager cannot
describe.

The name also comes from another app, so it is never used as a path as given —
`safeName` strips it to something that cannot climb out of the cache directory.
That and the extension check are the two things covered by
`app/src/test/java/io/blurrycontour/activitylens/IncomingFilesTest.java`, which
runs on the host with `./gradlew test`.

### Auto import (folder watching)

Settings → Auto import watches folders on the phone and imports any new workout
files into the library, so a watch or a recording app that saves there needs no
manual step.

Up to `FolderSync.MAX_FOLDERS` of them, because a phone that records with more
than one app has more than one export directory, and the alternative — picking a
common ancestor — hands the app far more of the filesystem than it needs. Each
folder keeps its own seen-set and its own last result; they are scanned
independently, so one that has become unreadable does not stop the others.

Four classes, split by lifetime like the push code:

| File | What |
|---|---|
| `FolderSyncPlugin` | the bridge: add a folder, remove one, enable, scan now |
| `FolderSync` | what survives process death — the folder list, the seen sets |
| `FolderScanner` | the scan itself, with no WebView anywhere |
| `FolderSyncWorker` | the two background jobs, both running with the app closed |

**The folder picker is the permission.** Access comes from
`ACTION_OPEN_DOCUMENT_TREE`: the user picks a directory and the app can read that
directory and nothing else. No storage permission is requested and none is
declared, which is the entire reason to do it this way rather than asking for
`READ_EXTERNAL_STORAGE` and getting the whole phone.

`takePersistableUriPermission` is what makes it survive. Without it the grant
lasts until the process dies and then silently stops working — a background job
that quietly does nothing forever, which is the worst shape this bug could take.
`disable()` hands the grant back, because the system caps how many an app may
hold.

**Android does the watching.** JobScheduler will observe a content URI and start
a job when it changes, which WorkManager exposes as `addContentUriTrigger`. A
`DocumentsProvider` calls `notifyChange` on a directory's *children* URI when
something is added to or removed from it — `FolderSync.childrenUri` builds it
with `buildChildDocumentsUriUsingTree`, since the tree URI itself names the grant
and nothing notifies on it. So a new workout file starts the scan directly. No
foreground service, no permanent notification, and no wake-ups at all on the days
nothing is recorded.

`FolderSyncWorker` therefore runs two jobs:

| Job | Kind | Why |
|---|---|---|
| `folder-sync` | periodic, 15 minutes | the mechanism |
| `folder-sync-watch` | one-shot, content trigger | an accelerator, best-effort; a trigger is spent by firing, so `doWork` re-arms it every run, on the failure path too |
| `folder-sync-catchup` | one-shot, on app start | see below |

**The trigger is not the mechanism, and this was built the other way round
first.** A trigger only fires if the `DocumentsProvider` calls `notifyChange`,
and `ExternalStorageProvider` — which backs ordinary device storage — announces
the documents *it* was asked to create through SAF. A recording app writing an
export straight to its own directory does not go through SAF, so nothing is
announced and nothing fires. Leaning on it and stretching the schedule to six
hours meant files sat unimported until the app was next opened. The trigger is
kept because it costs nothing and is immediate when it does fire; the schedule is
what the feature is built on, and the schedule is short.

One watch job carries a trigger per folder rather than a job each, since they all
run the same scan and which URI fired is not worth knowing. Triggers are fixed
when the job is armed, so adding or removing a folder re-arms it.

`folder-sync-catchup` mostly duplicates what WorkManager does anyway — it runs
overdue periodic work when the process starts — and exists for when it does not:
someone who suspects a file was missed opens the app to check, and that is when
it should look rather than up to fifteen minutes later. `KEEP`, so reopening
queues one scan rather than a pile.

`FolderSyncPlugin.load()` re-schedules **both** jobs on every app start. They
used to be created only by `setEnabled` and `setInterval`, so they existed
exactly as long as WorkManager's database said they did — a force stop, an OEM
that clears jobs, or a restore onto a new phone left auto-import silently doing
nothing behind a Settings screen that still said it was on. Both unique names use
`UPDATE`/`REPLACE`, so re-scheduling is idempotent and the watch repairs itself.

The trigger is registered with a 15-second settle delay and a 5-minute maximum,
because a file being written arrives as a burst of notifications and the first
one points at a half-written GPX.

**Neither escapes Doze.** The OS still decides when these run, and a phone with
the app battery-restricted runs them late or not at all — which is the usual
reason auto-import appears not to work, and is invisible from inside the app.
`getStatus` reports `batteryUnrestricted` from `PowerManager` so Settings can say
so, and `requestBatteryExemption` opens the system dialog. Declining is fine and
changes nothing; the watch still runs, just whenever Android feels like it. A
trigger cannot be persisted across a reboot the way an ordinary job can, so
WorkManager rebuilds it from its own database — and `FolderSyncPlugin.load()`
re-arms on every app start for the cases where it did not.

"Scan now" remains, as the answer to "is this working?".

**Each scan does as little as possible**, because it runs forever on a folder
that mostly does not change:

1. files fingerprinted by URI, size and modified time are skipped unopened
2. what remains is hashed and offered to `/api/workouts/import/known` in **one**
   request
3. only genuinely new files are uploaded, with `deferChecks` set
4. `/import/finalize` then runs the gear and goal checks once and asks for the
   notification

Step 2 is the one that matters. Without it every scan would re-upload the whole
folder; the server would deduplicate by content hash and nothing would break, but
it would move the entire library over the network on every scan.

The seen-set is an optimisation and nothing more — the server's content hash is
what actually prevents duplicate imports, so losing the set costs one scan's work
and never correctness. That is why it can be capped and thrown away when full.

Only `.gpx` and `.tcx` are imported, including `.gz` of either. `.fit` is
deliberately skipped rather than attempted: the backend has no parser for it, so
importing one would fail per file, on every scan, forever.

The notification is a real server-side kind (`workout_imported`), not a local
one, so it appears in the in-app bell, syncs to your other devices, and obeys the
per-kind switch in Settings like everything else.

It links to **that scan's** imports, not to every workout the folder watch has
ever brought in: the link carries `?source=autoimport&since=…&until=…`, and the
client shows auto-imports created inside that closed interval.

**Closed at both ends, and that matters.** A notification is permanent and gets
opened whenever the user gets to it — by then the folder watch has usually run
again. With only a lower bound the older notification's window kept growing, so
"3 workouts imported" opened onto five, still captioned as the batch.

**The window is derived server-side, from the count alone.** The scanner reports
"3 imported"; `ImportWindow` reads back the `created_at` of the newest and the
third-newest auto-import, and that is the window. The phone is never asked when
the batch began.

That was not the first design, and the two that came before it are worth knowing
because both failed *silently*:

- the phone sending its own clock — a device a few minutes ahead of the server
  produces a window matching nothing, on someone else's phone, invisibly;
- the phone sending the server's `Date` header — correct, but only from a build
  that has the code. An older APK still installed alongside a new one keeps
  sending nothing, and the notification quietly links to everything.

The database already knows when those workouts arrived, so nobody has to be
asked, and any version of the app — including one built before the feature
existed — gets a correct link.

The link is built server-side, so a change to it needs the **server** redeployed,
not just a new APK.

The **full rescan** button clears the seen-set before scanning. The ordinary scan
skips files it has handled, which is what keeps a 15-minute job cheap, but it
also means a workout deleted from the library never comes back — the file that
produced it is still marked done. Forcing is the way back; the server's
content-hash check still stops anything still present being imported twice.

Scan frequency is a per-device setting in the app's own preferences, never in the
database. It describes this phone's battery and this phone's folder, and syncing
it would let a tablet that has never seen the folder dictate how often the phone
looks.

### Permissions

Three are declared, and they are requested in three different ways because
Android has three kinds:

| Permission | When | How |
|---|---|---|
| `INTERNET` | install | granted automatically, no prompt exists |
| `POST_NOTIFICATIONS` | first launch | `MainActivity.askForNotifications`, once |
| `WRITE_EXTERNAL_STORAGE` | first export, Android 9 and older only | in context, from `ShellPlugin` |
| `REQUEST_INSTALL_PACKAGES` | first in-app update | special access — a settings screen, opened by the updater |

Notification permission is asked for at launch rather than when push is switched
on. That is a deliberate departure from Google's guidance, which prefers asking
in context: one prompt on first run beats an interruption later, and the
in-context request still exists for anyone who declines and changes their mind.
It is asked **once** — Android silently refuses a third attempt, and a prompt on
every cold start would be worse than no push at all.

`REQUEST_INSTALL_PACKAGES` cannot be requested this way at all: it is special
access, granted from a system settings screen. Sending a new user there before
they have ever seen an update would be asking them to approve something
frightening for no visible reason, so the updater opens it at the point it is
needed.

## Not here yet

Folder watching, share-sheet and "open with" intents are the next round. The
import pipeline they need — content-hash dedupe via `/api/workouts/import/known`
— already exists and is what makes a repeated folder scan cheap.
