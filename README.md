<div align="center">

# <img src="frontend/public/logo.svg" width="64" valign="middle" alt="Activity Lens logo" /> Activity Lens

**A self-hosted haven for your training history.**

Import runs, rides, hikes and swims from `.fit`, `.gpx` or `.tcx` files, plan and
run gym sessions, and see what the numbers actually say. One container, one
SQLite file, no external services — your data stays on your own server.

[![CI](https://github.com/blurrycontour/activity-lens/actions/workflows/ci.yml/badge.svg)](https://github.com/blurrycontour/activity-lens/actions/workflows/ci.yml)
[![Docker](https://github.com/blurrycontour/activity-lens/actions/workflows/docker.yml/badge.svg)](https://github.com/blurrycontour/activity-lens/actions/workflows/docker.yml)
[![CodeQL](https://github.com/blurrycontour/activity-lens/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/blurrycontour/activity-lens/actions/workflows/github-code-scanning/codeql)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**[Documentation](https://blurrycontour.github.io/activity-lens/)** ·
[Deployment](https://blurrycontour.github.io/activity-lens/admin/deployment/) ·
[Configuration](https://blurrycontour.github.io/activity-lens/admin/configuration/)

</div>

---

## Quick start

```bash
git clone https://github.com/blurrycontour/activity-lens.git
cd activity-lens

mkdir -p .data                 # bind-mounted at /data; owned by uid 1000
AL_ADMIN_PASS='pick-something-better' docker compose up -d
```

Open <http://localhost:9090> and sign in as `admin`.

> [!IMPORTANT]
> `AL_SECURE_COOKIES` defaults to `true`, so session cookies are only sent over
> HTTPS. For a plain-HTTP test on localhost, start with
> `AL_SECURE_COOKIES=false` — otherwise sign-in appears to succeed and bounces
> you straight back to the login screen.

A prebuilt image is published to GHCR, so `docker compose up -d` without a
clone works too — see [Deployment](docs/admin/deployment.md) for that, plus
reverse proxies, HTTPS, backups and upgrades. Every environment variable is in
[Configuration](docs/admin/configuration.md).

## What you get

- **Import** `.fit`, `.gpx` and `.tcx` — one file, hundreds, or a whole
  Strava/Garmin export `.zip` dropped in as it came. Content-addressed, so a
  re-import is a no-op rather than a duplicate, and a corrupt file never costs
  you the rest of the batch.
- **Read** a workout with its route map and playback, heart-rate, pace,
  elevation, cadence and power charts, splits and zones.
- **Understand** it across four pages: dashboard with goals and streaks,
  analysis (records, trends, efficiency, load), consistency (heatmap, habits,
  year-over-year) and equipment wear.
- **Plan** gym training — days, supersets, sections — and run sessions with a
  timer that survives a locked phone, then see them in your history and totals.
- **Share** any workout, plan or session with named people or with everyone on
  your instance. A shared plan can be cloned; nothing is readable without an
  account, and there are no public links.
- **Live with it**: installable PWA with an offline shell, an Android build with
  share-sheet import, Web Push notifications, light/dark themes with a choice of
  accents, optional OIDC/SSO and SMTP, and an admin panel.

## Documentation

The full docs are at **<https://blurrycontour.github.io/activity-lens/>**, and
the Markdown behind them is in [`docs/`](docs/):

| | |
|---|---|
| [Using it](docs/user/getting-started.md) | Getting started, workouts, training plans, insights, sharing |
| [Running it](docs/admin/deployment.md) | Deployment, reverse proxies, backups, upgrades, every setting |
| [Building it](docs/dev/setup.md) | Local setup, architecture, UI conventions, the Android app |

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

Built for a handful of people using it for years rather than for scale. The SQL
is kept portable so a Postgres backend can be added without touching business
logic — see [Architecture](docs/dev/architecture.md).

## Contributing

Issues and pull requests are welcome. [Local setup](docs/dev/setup.md) covers
the layout and how to run things; CI runs `go vet`, `gofmt`, `go test`, a
TypeScript typecheck, Vitest and a production build on every push.

## License

[MIT](LICENSE) © Aditya Singh
