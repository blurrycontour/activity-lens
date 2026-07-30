# Deployment

Activity Lens ships as one container: a static Go binary with the frontend
compiled into it, on a distroless base, running as a non-root user. There is no
separate web server, database container or job runner.

## Docker Compose

```bash
mkdir -p .data
AL_ADMIN_PASS='pick-something-better' docker compose up -d
```

### Building it yourself

The server image bundles the Android APK, which is built separately — putting the
Android SDK inside the server image build would make every backend change cost
minutes. One script does both steps:

```bash
scripts/deploy.sh              # build the APK, then build and start the image
scripts/deploy.sh --release    # a release-signed APK (needs AL_KEYSTORE)
scripts/deploy.sh --no-apk     # reuse whatever is already in mobile/dist/
```

`docker compose up -d --build` still works on its own. It bundles whatever APK is
in `mobile/dist/` at the time, or none — in which case the server reports no app
available, which is a perfectly valid way to run it. See
[mobile/README.md](../mobile/README.md).

`docker-compose.yml` bind-mounts `./.data` to `/data` and runs as `1000:1000`,
so that directory must be writable by uid 1000 on the host. If your user has a
different uid, change the `user:` line to match `id -u`:`id -g`.

The container listens on 8080 and compose publishes it as **9090**.

## Using the prebuilt image

Images are published to GHCR on every push to `main` and on tags:

```yaml
services:
  activity-lens:
    image: ghcr.io/blurrycontour/activity-lens:latest
    # ...the rest as in docker-compose.yml
```

Pin a version tag (`:1.2.3`) rather than `:latest` if you would rather upgrade
deliberately.

## Behind a reverse proxy

**HTTPS is effectively required.** Service workers, Web Push and installing the
PWA all need a secure context, and `AL_SECURE_COOKIES=true` needs it for sessions.

### Caddy

```caddyfile
activity.example.com {
    reverse_proxy localhost:9090
}
```

Caddy handles certificates and sets `X-Forwarded-Proto` on its own, which is what
the app reads to decide a request is secure.

### Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name activity.example.com;

    # ssl_certificate ... ;

    location / {
        proxy_pass http://127.0.0.1:9090;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;   # required

        # Uploads are capped at 25 MiB by the app; let them through.
        client_max_body_size 25m;
    }
}
```

`X-Forwarded-Proto` matters: without it the app cannot tell a proxied HTTPS
request from a plain one, and will refuse to set a secure session cookie.

> [!NOTE]
> When the app is down but the proxy is up, the proxy answers `502`. Activity
> Lens treats gateway statuses (502/503/504, and Cloudflare's 521–524) as
> "backend unreachable" — it shows the offline banner and serves cached data,
> rather than mistaking the proxy's reply for a healthy response.

## Backups

Everything is under `AL_DATA_DIR`:

```
.data/
  activity-lens.db      SQLite: workouts, users, sessions, settings, notifications
  activity-lens.db-wal  write-ahead log
  activity-lens.db-shm  shared memory
  avatars/              uploaded profile pictures
```

WAL mode means copying `activity-lens.db` alone can miss recent writes. Back it
up with SQLite's own backup, which is consistent without stopping the container:

```bash
docker compose exec activity-lens \
  sh -c 'sqlite3 /data/activity-lens.db ".backup /data/backup.db"' 2>/dev/null \
  || docker compose stop && tar czf backup.tgz .data && docker compose start
```

The distroless image has no shell or `sqlite3`, so in practice the simple and
reliable route is: stop, archive `.data`, start. It takes seconds.

To restore, drop the files back into `.data` and start the container.

> [!IMPORTANT]
> The database holds the VAPID keypair used for push notifications. Restoring an
> old backup restores the old keypair, which is what you want. Deleting the
> database and starting fresh mints a new one and silently invalidates every
> device's push subscription — each user has to re-enable notifications.

## Upgrading

```bash
docker compose pull        # or: docker compose build
docker compose up -d
```

Migrations run automatically on start and are safe to re-run — there is no
version table, each file is idempotent and applied on every boot. Take a backup
first anyway.

Open browsers do not reload themselves. The next time someone opens the app they
get an **"Update available"** prompt; the new version applies when they tap
Reload, or on the next full app restart. That is deliberate — silently reloading
can discard a half-written note. See
[architecture.md](architecture.md#service-worker-and-updates).

## Installing the PWA

Visit the site over HTTPS and use the browser's install prompt ("Add to Home
Screen" on mobile, the install icon in the address bar on desktop).

Worth doing on Android: an installed PWA gets a WebAPK, so notifications are
attributed to **Activity Lens** rather than showing your site's URL. On iOS,
installing is the only way to get push notifications at all.

## Health and logs

```bash
docker compose logs -f activity-lens
```

Structured JSON. Startup logs the database path, account count and effective
config; every API request is logged with method, path, status, duration and user,
at `ERROR` for 5xx and `WARN` for 4xx — so a failing deployment stands out
without raising the log level. Failed sign-ins are logged with the attempted
identifier and source IP.
