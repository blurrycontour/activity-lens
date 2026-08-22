# Activity Lens

A self-hosted haven for your training history. Import runs, rides, hikes and
swims from `.fit`, `.gpx` or `.tcx` files, plan and run gym sessions, and see
what the numbers actually say — on your own server, in one container.

<div class="grid cards" markdown>

- :material-account: **[Using it](user/getting-started.md)**

    Signing in, importing workouts, training plans, the charts, and sharing with
    the other people on your server.

- :material-server: **[Running it](admin/deployment.md)**

    Docker Compose, reverse proxies, backups, upgrades, and every configuration
    option there is.

- :material-code-braces: **[Building it](dev/setup.md)**

    Local setup, architecture and the decisions behind it, UI conventions, and
    the Android app.

</div>

## What it is

One Go binary with the frontend embedded, one SQLite file, no external services.
It is built for a handful of people using it for years rather than for scale,
and everything it holds stays on the machine you run it on — nothing is readable
without an account on that instance, and there are no public links.

```bash
git clone https://github.com/blurrycontour/activity-lens.git
cd activity-lens
mkdir -p .data
AL_ADMIN_PASS='pick-something-better' docker compose up -d
```

Then open <http://localhost:9090> and sign in as `admin`. The full walkthrough,
including the HTTPS cookie trap that catches everyone once, is in
[Deployment](admin/deployment.md).
