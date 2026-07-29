<div align="center">

# <img src="frontend/public/logo.svg" width="64" valign="middle" alt="Activity Lens logo" /> Activity Lens

**A self-hosted home for your training history.**

Import runs, rides, hikes and swims from `.gpx` or `.tcx` files, then see what the
numbers actually say — trends, consistency, training load, gear wear and personal
bests. Your data stays on your own server.

[![CI](https://github.com/blurrycontour/activity-lens/actions/workflows/ci.yml/badge.svg)](https://github.com/blurrycontour/activity-lens/actions/workflows/ci.yml)
[![Docker](https://github.com/blurrycontour/activity-lens/actions/workflows/docker.yml/badge.svg)](https://github.com/blurrycontour/activity-lens/actions/workflows/docker.yml)
[![CodeQL](https://github.com/blurrycontour/activity-lens/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/blurrycontour/activity-lens/actions/workflows/github-code-scanning/codeql)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

---

## Why

Most training analysis lives in someone else's cloud, tied to a watch brand, and
shows you charts you cannot change. Activity Lens is a single container you run
yourself: one Go binary with the frontend embedded, one SQLite file, no external
services. It is built for a handful of people using it for years, not for scale.

## Features

**Track**
- Import `.gpx` and `.tcx` files, or enter a workout by hand. Re-importing the
  same file is a no-op — imports are content-addressed, so a repeated share from
  a tracker app updates nothing instead of creating a duplicate.
- Route map with playback, plus heart-rate, pace, elevation and cadence charts
  and splits. Track shading by pace, heart rate, elevation or cadence.
- Calories and steps are taken from the file when it states them, and estimated
  otherwise (heart-rate or distance based, your choice).
- Private notes on any workout.
- Export any workout as GPX, and — when the server is set to keep originals —
  download the exact file it was imported from. Your data stays yours to take.

**Understand**
- **Dashboard** — stat cards with period-over-period deltas and sparklines,
  weekly trend, training goals with streaks, personal bests, and gear nudges.
- **Analysis** — records, trends, efficiency factor, and acute:chronic training
  load, all under one time filter.
- **Consistency** — calendar heatmap, day-of-week distribution, year-over-year
  and week-over-week comparisons, cumulative distance.
- **Equipment** — track gear, mileage and wear against a replace-at distance.

**Share**
- Make a workout visible to everyone signed in to your instance, or share it
  with specific people. Nothing is ever readable without an account.
- Browse what others have shared from the Workouts page. Shared workouts open in
  full read-only detail — minus the owner's private notes and equipment.

**Live with**
- Installable PWA with an offline shell, pull-to-refresh, and Android
  share-sheet import.
- Web Push notifications for shares, gear wear and training goals — including
  when the app is closed.
- Light and dark themes with a choice of accent colours.
- Optional OIDC/SSO, SMTP for account emails, and an admin panel for users.

## Quick start

```bash
git clone https://github.com/blurrycontour/activity-lens.git
cd activity-lens

mkdir -p .data                 # bind-mounted at /data; owned by uid 1000
AL_ADMIN_PASS='pick-something-better' docker compose up -d
```

Open <http://localhost:9090> and sign in as `admin`.

> [!IMPORTANT]
> `AL_SECURE_COOKIES` defaults to `true`, which means session cookies are only
> sent over HTTPS. For a plain-HTTP test on localhost, start with
> `AL_SECURE_COOKIES=false` — otherwise sign-in appears to succeed and then
> bounces you straight back to the login screen.

See [docs/deployment.md](docs/deployment.md) for reverse proxies, HTTPS, backups
and upgrades, and [docs/configuration.md](docs/configuration.md) for every
environment variable.

## Documentation

| | |
|---|---|
| [Configuration](docs/configuration.md) | Every environment variable, and what is settable from the admin UI instead |
| [Deployment](docs/deployment.md) | Reverse proxy, HTTPS, backups, upgrades, PWA install |
| [Architecture](docs/architecture.md) | How it fits together, and the decisions worth knowing before changing it |
| [Development](docs/development.md) | Running locally, tests, migrations, project layout |

## Screenshots

<!-- Add screenshots here. The dashboard, a workout detail with the map, and the
     consistency heatmap tend to be the three that show it best. -->

## Stack

| Layer | Choice | Why |
|---|---|---|
| Backend | Go 1.26, `net/http` | One static binary, no runtime to install |
| Database | SQLite (`modernc.org/sqlite`) | Pure Go, so `CGO_ENABLED=0`; one file to back up |
| Frontend | React 19, Vite, TypeScript | Compiled into the binary via `go:embed` |
| Charts | Recharts | |
| Maps | Leaflet + OpenStreetMap tiles | |
| Auth | [go-authkit](https://github.com/blurrycontour/go-authkit) | Sessions, OIDC, account management |
| Push | Web Push (VAPID) | Standard, no third-party service |

The SQL is kept portable so a Postgres backend can be added without touching
business logic — see [docs/architecture.md](docs/architecture.md).

## Contributing

Issues and pull requests are welcome.
[docs/development.md](docs/development.md) covers the layout and how to run
things. CI runs `go vet`, `gofmt`, `go test`, a TypeScript typecheck, Vitest and
a production build on every push.

## License

[MIT](LICENSE) © Aditya Singh
