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
| `AL_SESSION_TTL` | `720h` (30 days) | How long a signed-in session lasts. |

> [!WARNING]
> `AL_SECURE_COOKIES=true` over plain HTTP produces a confusing failure: login
> returns 200, the browser silently drops the cookie, and the next request is
> unauthenticated — so you land back on the login screen with no error. Either
> terminate TLS in front of the app, or set it to `false` for local testing.

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
