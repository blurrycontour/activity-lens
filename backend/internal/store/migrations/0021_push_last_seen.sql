-- When each push subscription was last confirmed by the device it belongs to.
--
-- Subscriptions are only ever added, and nothing removes one for a device that
-- simply stops coming back: a phone that is wiped, an app uninstalled, a
-- distributor registration replaced by a new one. Those rows are invisible
-- failures — the server keeps posting to them forever, and for ntfy that is not
-- even an error, because publishing to a topic nobody is subscribed to succeeds.
-- So they cannot be found by watching delivery fail; they have to be found by
-- noticing that nobody has vouched for them in a long time.
--
-- Every client re-sends its subscription on launch (syncPushSubscription on the
-- web, syncNativePush in the app), which is what keeps this column current for
-- anything still in use.
--
-- Defaulted to created_at, not to now: backfilling every existing row to the
-- moment of the upgrade would restart the clock for subscriptions that are
-- already long dead, which is the opposite of the point.
ALTER TABLE push_subscriptions ADD COLUMN last_seen_at TEXT NOT NULL DEFAULT '';
UPDATE push_subscriptions SET last_seen_at = created_at WHERE last_seen_at = '';
