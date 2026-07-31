# Configuration

Every setting is an environment variable prefixed `AL_`. Anything left unset
falls back to the default shown here.

Some settings can also be changed from the **Admin panel** at runtime, which
avoids a restart. Where both exist, **the environment variable wins** — it is
treated as an operator override and the admin UI shows the field as locked.

## Core

| Variable | Default | Notes |
|---|---|---|
| `AL_ADDR` | `:8080` | Listen address inside the container. The compose file maps it to host port 9090. |
| `AL_DATA_DIR` | `./.data` | Everything persistent lives here: the SQLite file, avatars and archived uploads. |
| `AL_DATABASE_URL` | *(unset)* | Reserved for a future Postgres backend; SQLite is used when empty. |
| `AL_SECURE_COOKIES` | `false` | Send session cookies only over HTTPS. **Set to `true` in production.** The compose file already defaults it to `true`. |
| `AL_COOKIE_NAME` | `al_session` | Change only if it collides with something else on the same domain. |
| `AL_SESSION_TTL` | `720h` (30 days) | How long a signed-in session lasts. This is also how often the Android app has to sign in again — it holds a session token, not a longer-lived credential of its own. |
| `AL_ANDROID_APP` | `true` | Offer the Android app: a download link on the login page, and the in-app update check. See below. |
| `AL_CORS_ORIGINS` | *(unset)* | Extra origins allowed to call the API cross-origin, comma-separated (`https://app.example.com`). Only needed if you serve the web app from a different address than the API; the Android app's own WebView origin is always allowed. |

> [!WARNING]
> `AL_SECURE_COOKIES=true` over plain HTTP produces a confusing failure: login
> returns 200, the browser silently drops the cookie, and the next request is
> unauthenticated — so you land back on the login screen with no error. Either
> terminate TLS in front of the app, or set it to `false` for local testing.

### The Android app

**The APK is inside the image.** It is built from the same commit as the server,
so the login page hands out the app that belongs with this deployment and the app
updates itself from the server it is already talking to. Nothing external is
involved — no GitHub, no internet beyond your own instance.

A client therefore cannot run ahead of its server: upgrading the server is what
offers users a new app. The cost is about 4 MB of image size.

Set `AL_ANDROID_APP=false` to turn it off. Worth doing if you do not want the app
offered at all, or if you would rather `/api/app/android` not tell anonymous
callers your version — that endpoint is public because the login page needs it,
and it is the one build fact that is not behind authentication. It reports the
app's version, size and checksum; the commit and toolchain stay behind
`/api/build`.

Images built without an APK (`mobile/dist/` empty) report `available: false` and
serve 404. See [mobile/README.md](../mobile/README.md) for building one.

### CORS

Nothing needs configuring for it. The app is a WebView on its own origin
(`https://localhost`) talking to your server, which makes every request
cross-origin, and that origin is on the allowlist already.

Two properties of the allowlist are worth knowing, because they are what make
opening the API to another origin safe:

- Origins are matched exactly against a fixed list. The `Origin` header is never
  reflected back, so an unlisted site gets no access regardless of what it sends.
- `Access-Control-Allow-Credentials` is never sent. A browser will therefore not
  attach your session cookie to a cross-origin request to this API, so a hostile
  page cannot act as you even if its origin were somehow allowed. The Android app
  does not rely on cookies at all — it sends a bearer token it holds itself.

`AL_CORS_ORIGINS` is only for the unusual case of serving the web frontend from a
different address than the API.

## First run and accounts

| Variable | Default | Notes |
|---|---|---|
| `AL_ADMIN_USER` | *(unset)* | Bootstrap administrator, created on first start if no such account exists. |
| `AL_ADMIN_EMAIL` | *(unset)* | |
| `AL_ADMIN_PASS` | *(unset)* | Change it after the first sign-in; it stays in your shell history and compose file otherwise. |
| `AL_ALLOW_REGISTRATION` | `false` | Allow anyone to create an account. Leave off for a private instance and add users from the admin panel. |

The bootstrap admin is only created when the account does not already exist, so
leaving these set across restarts is harmless — it will not reset the password.

## Notifications

| Variable | Default | Notes |
|---|---|---|
| `AL_PUSH_SUBJECT` | `mailto:admin@localhost` | Contact address embedded in every Web Push message. Required by the spec so a push service has someone to contact about abuse. Set it to a real address you own. |

The VAPID keypair that signs push messages is **generated on first start and
stored in the database** — there is nothing to configure. It must survive
restarts: regenerating it invalidates every existing browser subscription, and
every device would have to re-enable notifications.

Push additionally requires **HTTPS** (localhost is exempt). On iOS, Safari only
grants push to a PWA that has been added to the Home Screen.

### The Android app

The app does not use Web Push — the browser push service behind it is Google's,
and it does not exist on a de-Googled phone. It uses **UnifiedPush**: a
distributor app on the phone (usually [ntfy](https://ntfy.sh), pointed at your
own ntfy server if you run one) issues a push URL, and Activity Lens POSTs
notifications to it.

Nothing to configure on the server. There are no keys, `AL_PUSH_SUBJECT` does not
apply, and it works on an instance where Web Push was never set up. The user
picks a distributor in **Settings → Notifications** in the app; if none is
installed, that is what the screen says.

Worth knowing before you enable it: the notification's title and text pass
through the distributor, so it can read them. Full reasoning, and what is
deliberately never sent, in `mobile/README.md`.

## Single sign-on (OIDC)

All of these are also settable from **Admin → SSO**, which is usually easier.

| Variable | Notes |
|---|---|
| `AL_OIDC_ENABLED` | `true` to turn SSO on |
| `AL_OIDC_ISSUER_URL` | Discovery base URL, e.g. `https://auth.example.com/realms/main` |
| `AL_OIDC_CLIENT_ID` | |
| `AL_OIDC_CLIENT_SECRET` | |
| `AL_OIDC_REDIRECT_URL` | Must be `https://<your-domain>/api/auth/oidc/callback` |
| `AL_OIDC_ADMIN_GROUP` | Members of this group become administrators |
| `AL_OIDC_PROVIDER_NAME` | Label on the sign-in button; defaults to `SSO` |
| `AL_OIDC_LOGO_URL` | Logo shown on the sign-in button, in both themes |
| `AL_OIDC_LOGO_URL_DARK` | Optional replacement used only while the dark theme is active. Set it when the main logo is dark ink that disappears against the dark login card; leave it empty to use one logo everywhere |
| `AL_OIDC_ALLOW_REGISTRATION` | Create an account on first successful SSO login. Defaults to **`true`** — set it to `false` to restrict SSO to accounts that already exist |
| `AL_OIDC_SCOPES` | Comma-separated; sensible defaults are used when empty |

## Email (SMTP)

Only needed for account-deletion confirmation codes. Also settable from
**Admin → Email**, which includes a "send test email" button.

| Variable | Notes |
|---|---|
| `AL_SMTP_HOST` | |
| `AL_SMTP_PORT` | `587` by default |
| `AL_SMTP_USERNAME` | |
| `AL_SMTP_PASSWORD` | |
| `AL_SMTP_FROM` | Envelope sender address |
| `AL_SMTP_FROM_NAME` | Defaults to `Activity Lens` |
| `AL_SMTP_ENCRYPTION` | `starttls` (default), `tls`, or `none` |

## Settings that live only in the admin UI

- **Keep original uploads** — archive the `.gpx`/`.tcx` file each workout was
  imported from, under `<data dir>/raw-uploads`. They are zstd-compressed, which
  typically shrinks them more than tenfold, but they still grow the data
  directory over time.

  With this on, a workout's **⋯ → Download original** returns the file exactly
  as it was uploaded. That is not the same as **Export GPX**, which rebuilds a
  GPX from the parsed data and therefore drops device extensions and anything
  the importer does not model — the archive is the only copy of those. Archives
  are the owner's alone: they are not offered on shared or public workouts.

  The setting only affects imports made while it is on. Turning it on later does
  not backfill, and workouts imported while it was off simply have no
  **Download original**. Archives are deleted with their workout, and with their
  owner's account.

## Per-user preferences

These belong to each account and live under **Settings**, not in the environment:
body metrics, calorie-estimation method, heart-rate zones, training goals,
dashboard layout, chart preferences, theme and accent, and notification switches.
