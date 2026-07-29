# Development

## Prerequisites

- Go 1.26+
- Node 22+ and pnpm 11+

## Running locally

Two terminals. The backend serves the API; Vite serves the frontend with hot
reload and proxies `/api` across.

```bash
# Terminal 1 — backend on :8080
cd backend
AL_DATA_DIR=./.data \
AL_ADMIN_USER=admin AL_ADMIN_EMAIL=admin@localhost AL_ADMIN_PASS=devpassword \
AL_SECURE_COOKIES=false \
go run ./cmd/server
```

```bash
# Terminal 2 — frontend on :5173
cd frontend
pnpm install
pnpm dev
```

Open <http://localhost:5173>.

> [!IMPORTANT]
> `AL_SECURE_COOKIES=false` is required over plain HTTP. With it on, login
> returns 200, the browser drops the cookie, and you bounce back to the login
> screen with no error shown.

Some features need the production build or HTTPS: the service worker, Web Push,
PWA install and the Android share target. Test those with
`docker compose up --build`, behind a TLS-terminating proxy.

## Tests

```bash
cd backend  && go vet ./... && go test ./...
cd frontend && pnpm typecheck && pnpm test && pnpm build
```

CI runs exactly this, plus a `gofmt` check, on every push and pull request.

What is covered, and why — these were all real bugs:

| Area | Test | Guards against |
|---|---|---|
| Migrations | `internal/store/migrate_test.go` | A fresh database failing, a re-run failing, or a new `.sql` never being wired into `MigrateApp` |
| Sharing | `internal/workout/sharing_test.go` | The authorization matrix, redaction of notes and equipment, ownership on every mutation, cascade on delete |
| Notifications | `internal/notify/notify_test.go` | Dedupe firing once, disabled kinds being dropped, per-user scoping, unknown kinds defaulting to *on* |
| Web Push | `internal/notify/push_test.go` | Delivery actually reaching the wire (real VAPID signing and encryption against an `httptest` server), and expired subscriptions being cleaned up on 410 |
| API contracts | `internal/httpapi/contract_test.go` | `decodeJSON` rejecting the browser's real push-subscription payload; the user directory leaking emails |
| Import | `internal/ingest/ingest_test.go` | Cadence and calorie parsing from `.gpx`/`.tcx` |
| Offline | `src/lib/__tests__/network.test.ts` | Gateway errors and cache hits being mistaken for a healthy backend |
| Dates | `src/lib/__tests__/range.test.ts` | UTC drift filing workouts under the wrong day |
| Goals | `src/lib/__tests__/insights.test.ts` | A 4,983 m run displayed as "5.0 km" not counting toward a 5 km goal |

Frontend tests are Vitest and cover pure logic in `src/lib` and `src/components`
— there is no DOM-rendering suite. Note that Vitest does **not** typecheck; run
`pnpm typecheck` too.

## Adding a migration

1. Create `backend/internal/store/migrations/00NN_description.sql`.
2. Add a `//go:embed` var for it in `internal/store/db.go`.
3. Append it to the list in `MigrateApp`.

Rules, because every file runs on every start:

- Make it idempotent — `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN`
  (whose duplicate-column error is tolerated), `CREATE INDEX IF NOT EXISTS`.
- Keep the SQL portable; no SQLite-only syntax.
- No semicolons inside a statement — `applyAlters` splits on them.
- Table creations belong before the ALTERs that modify them.

`migrate_test.go` will fail if you skip step 2 or 3.

## Conventions

- **Comments explain why, not what.** The code says what it does; comments carry
  the reasoning that would otherwise be lost — especially where something looks
  wrong but is deliberate.
- **Domain packages own their SQL** behind a `Repository` interface. Handlers
  stay thin.
- **Styling** is hand-written CSS in `src/index.css` using custom properties,
  plus inline styles for data-driven values. Despite the Tailwind dependency, the
  app is not written with utility classes.
- **Colours** come from CSS variables so they follow the theme and accent.
  Ordered series use a single-hue ramp derived from the accent; unordered series
  use fixed tokens. Recharts takes concrete `rgb()` values, since `color-mix()`
  does not work in SVG attributes.
- **Mobile matters.** The breakpoint is 768px, defined once in
  `lib/useIsMobile.ts` to match the CSS media queries.

## Project files

| | |
|---|---|
| `Dockerfile` | Multi-stage: frontend build → backend build with the frontend embedded → distroless runtime |
| `docker-compose.yml` | Local and self-hosted deployment |
| `.github/workflows/ci.yml` | vet, gofmt, Go tests, typecheck, Vitest, build |
| `.github/workflows/docker.yml` | Builds and publishes the image to GHCR |
