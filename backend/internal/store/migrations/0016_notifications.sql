-- In-app notifications, plus the Web Push subscriptions used to deliver them
-- when the app is closed.
CREATE TABLE IF NOT EXISTS notifications (
    id         TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    kind       TEXT    NOT NULL,
    title      TEXT    NOT NULL,
    body       TEXT    NOT NULL DEFAULT '',
    -- In-app path to open when the notification is tapped, e.g. /workouts/<id>.
    link       TEXT    NOT NULL DEFAULT '',
    -- Identifies the condition that produced this notification, so a standing
    -- condition (a worn-out shoe, a goal already met) notifies once instead of
    -- on every workout that re-evaluates it. NULL means "always distinct".
    dedupe_key TEXT,
    read_at    TEXT,
    created_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
    ON notifications (user_id, created_at DESC);
-- Unread counts are read on every page load, so they get their own partial index.
CREATE INDEX IF NOT EXISTS idx_notifications_unread
    ON notifications (user_id) WHERE read_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe
    ON notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- One row per browser/device that has granted permission. The endpoint URL is
-- the identity: re-subscribing on the same device returns the same endpoint, so
-- it is the primary key rather than a generated id.
--
-- No foreign key to users, for the same reason as workout_shares: go-authkit
-- deletes accounts with a bare DELETE and an FK here would abort it.
CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint   TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    p256dh     TEXT    NOT NULL,
    auth       TEXT    NOT NULL,
    user_agent TEXT    NOT NULL DEFAULT '',
    created_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions (user_id);

-- Per-user notification switches, stored as JSON like the goals column.
ALTER TABLE user_prefs ADD COLUMN notify_prefs TEXT NOT NULL DEFAULT '';
