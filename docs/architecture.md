# Architecture

One Go binary serves the API and the compiled frontend. One SQLite file holds
everything. This document covers how the pieces fit and, more usefully, the
decisions that are easy to undo by accident.

```
browser ──► Go binary ──► SQLite
   │          │  ├── /api/*      JSON API
   │          │  └── /*          embedded SPA (go:embed all:dist)
   └── service worker: offline shell, API cache, Web Push
```

## Layout

```
backend/
  cmd/server/           entrypoint, wiring, graceful shutdown
  internal/
    httpapi/            HTTP handlers, routing, middleware
    workout/            workouts + sharing: model, store, service
    equipment/          gear
    notify/             notifications + Web Push
    settings/           app settings and per-user preferences
    ingest/             .fit / .gpx / .tcx parsing
    imageutil/          avatar processing, identicon generation
    store/              database connection + migrations
    web/                go:embed of the built frontend
frontend/
  src/
    pages/              one file per route
    components/         shared UI
    lib/                pure logic: insights, ranges, network, push
    context/            auth, workouts, refresh
    sw.ts               service worker (injectManifest)
```

Each domain package owns a `Repository` interface, a SQLite implementation and a
`Service` holding the rules. Handlers stay thin.

## Decisions worth knowing

### SQL is kept Postgres-portable

No SQLite-only syntax, no driver-specific error types. Unique-violation
detection matches both dialects' messages; partial indexes and `ON CONFLICT` are
used because both engines support them. The one place this leaks is
`applyAlters`, which tolerates SQLite's "duplicate column name" string — noted in
the code as the thing to revisit if Postgres ever lands.

### Migrations are idempotent, not versioned

Every file in `internal/store/migrations/` is embedded and applied on **every**
start. `CREATE TABLE IF NOT EXISTS` files run whole; `ALTER TABLE` files go
through `applyAlters`, which runs each statement individually and swallows
duplicate-column errors.

Two consequences:
- Table creations must be ordered before the ALTERs that modify them.
- A new `.sql` file does nothing until it is `//go:embed`-ed **and** added to the
  list in `MigrateApp`. `internal/store/migrate_test.go` guards both.

### Authorization lives in SQL, in exactly one place

`workout.Repository.GetViewable` is the only query that can return a workout the
caller does not own. Its predicate — *mine, or public, or shared with me* — is in
the statement itself. Every other method is owner-scoped (`WHERE user_id = ?`),
so a check forgotten anywhere else fails closed with `ErrNotFound` rather than
leaking.

Redaction is likewise structural: `Workout.Redact()` clears the owner-private
fields and the **service** applies it to anything handed to a non-owner, so no
handler can leak them by omission.

### The auth schema is not ours

[go-authkit](https://github.com/blurrycontour/go-authkit) owns the `users`,
`sessions` and OIDC tables, in the same SQLite file. Activity Lens never modifies
them and never joins to them:

- No foreign keys to `users`. authkit deletes accounts with a bare `DELETE`, and
  with `foreign_keys=ON` an FK would abort it. Orphaned rows are filtered out
  when they are resolved, and purged explicitly on account deletion.
- Owner names for feeds are resolved with one `ListUsers` call per request in the
  API layer, not a SQL join — so auth could move to its own database without
  touching any query.

### Deleting an account deletes everything

Because nothing keys to `users`, removing an account cleans up nothing on its
own. `httpapi.purgeUserData` is the single list of what a user owns — workouts
and their archived uploads, gear, shares in both directions, notifications and
push subscriptions, preferences, last-login, and the avatar file — and both
deletion paths (admin, and self-service from Settings) go through it.

Two things make this easy to get wrong, so both are pinned by tests:

- **A new user-scoped table is a silent storage leak.** Nothing breaks when its
  rows are orphaned; they just accumulate. `TestEveryUserScopedTableHasAnOwnerForPurging`
  enumerates every table with a `user_id` column and fails if one is not
  accounted for.
- **SQLite reuses user ids.** A deleted account's id is handed to the next user
  created, so a surviving `user_prefs` row means someone inherits a stranger's
  body weight, max HR and training goals.

Each step is best-effort and logged rather than fatal: the account is already
gone by then, so failing the response would report the wrong outcome and invite
a retry that cannot work. The purge also runs on a context detached from the
request, so a browser navigating away mid-delete cannot cancel it half-finished.

### Sharing: public means "signed in here"

There are no share tokens and no unauthenticated read path. `visibility` is a
column on the workout (`private` | `public`); direct shares are a separate table.
They are **orthogonal**: making a workout private again does not revoke direct
shares. There is deliberately no `shared` visibility value, which would duplicate
what `workout_shares` already records.

### Notifications are best-effort by construction

`notify.Service.Notify` returns no error. Notifying is a side effect of some
other operation — a share, an import — and failing that operation because a
notification could not be written would be the wrong trade. Failures are logged.

Standing conditions (a worn-out shoe, a met goal) carry a `dedupe_key` backed by
a partial unique index, so they fire once rather than after every workout that
re-evaluates them. The index's `WHERE` clause has to be repeated in the
`ON CONFLICT` target — both SQLite and Postgres match a partial index by its
predicate as well as its columns.

### Web Push

The VAPID keypair is generated on first run and stored in the database, so push
works on a fresh install with nothing configured. It must survive restarts:
regenerating invalidates every subscription.

Delivery failures are logged, never returned — the notification is already stored
and visible in-app. A `404`/`410` from a push service is the only signal a
browser gives that a subscription has lapsed, so those endpoints are deleted on
the spot.

While the app is visible, the service worker **suppresses** the OS notification
and forwards the payload to the page, which shows an in-app banner instead.
Chrome permits this within a budget rather than unconditionally, which is why it
is gated on a window actually being visible.

### Offline detection

"The backend is unreachable" has three shapes, and missing any one of them breaks
the offline banner:

1. The fetch throws — no route to the host.
2. The service worker answers from cache — stamped with `x-al-from-cache`.
3. **A reverse proxy answers `502`** — the fetch resolves with a perfectly valid
   response that never reached the app.

`respondedFromBackend()` in `lib/network.ts` is the single predicate covering all
three, and the service worker throws on gateway statuses so NetworkFirst falls
back to cache instead of passing the 502 through. The distinction that matters:
a `500` means the app *is* reachable and has a bug; a `502` means it is not.

Correspondingly, only the app itself can sign you out. A `401` is a verdict; a
gateway error or a dropped connection is an outage, and the last known user is
restored from `localStorage` so being offline does not dump you on the login
screen.

### Service worker and updates

`injectManifest`, not `generateSW`, because the Android share target needs a
hand-written POST handler.

The trigger for an update is **any byte difference in `sw.js`**, which embeds a
precache manifest of content hashes. So any changed asset triggers it — and since
`__APP_VERSION__` is inlined into the bundle from `git describe`, so does any
commit, including backend-only ones.

`registerType: 'prompt'`: a new worker installs and *waits*. Applying it
immediately would reload the page underneath whatever the user is doing.
`skipWaiting()` is only called in response to the app's `SKIP_WAITING` message —
that handler is load-bearing, because with `injectManifest` nothing calls it for
us and a new build would otherwise wait forever.

### Timelines are gzipped JSON blobs

Route, heart-rate, pace, elevation and cadence series are JSON, gzipped, stored
as blobs. `ListSummary` omits them entirely — list and dashboard views need only
the scalar fields, and deserializing tens of KB per workout to render a card is
the difference between a fast dashboard and a slow one. Rows written before
compression was introduced are plain JSON and still read fine.

### Imports are content-addressed

The SHA-256 of the uploaded bytes becomes the workout's external ID, under a
partial unique index on `(user_id, source, external_id)`. Re-importing the same
file resolves to the existing workout untouched rather than duplicating it, and
without clobbering edits made since.

That identity is also what makes bulk import cheap. `POST /api/workouts/import/known`
takes a batch of hashes the client computed locally and returns the subset
already stored, so the second import of an export archive — or any rescan of a
folder — costs **one small request** instead of re-uploading every file to
discover it was a duplicate. The client hashes with `crypto.subtle` over the
same bytes the server hashes, so the two agree by construction; a test on each
side pins the value so they cannot drift apart silently.

### Bulk import defers the post-import checks

Recording a workout normally triggers a gear-wear and goal evaluation, and each
one reads the user's **entire** library. That is fine once and quadratic across
a few hundred files, so an import can pass `deferChecks` and call
`POST /api/workouts/import/finalize` once when the batch ends. Notifications are
deduped by key, so one evaluation for the batch produces exactly what the
per-file version would have. Measured against a 400-workout library, 25 imports
run roughly twice as fast deferred — and the gap widens as the library grows,
which is precisely when it matters.

### Archives are unpacked in the browser

A Strava export is a `.zip` of `activities/*.gpx.gz` and raw `.fit`, so both
layers come off before there is anything the parser recognises.
`lib/importQueue.ts` does that client-side with `fflate`: it avoids uploading a
multi-hundred-megabyte archive, and it keeps zip-bomb handling out of the
backend entirely. Expansion is bounded on entry count and total bytes, and
anything it cannot use — the `activities.csv`, a stray photo — is *reported*
rather than dropped, so every file the user selected is accounted for in the
counts they see.
