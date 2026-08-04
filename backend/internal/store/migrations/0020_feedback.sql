-- User-submitted feedback, with optional diagnostics.
--
-- Kept in its own table rather than folded into notifications: a notification is
-- a message to one person that is read and then gone, while feedback is a report
-- that outlives being read and that an admin works through. They also have
-- opposite retention needs — purging notifications after a while is fine, losing
-- a bug report is not.
--
-- diagnostics is nullable and holds a JSON blob only when the user chose to
-- attach it. Separating it from the message means a listing can be rendered
-- without loading log dumps that are several kilobytes each.
--
-- No foreign key to users, and purged in httpapi.purgeUserData like everything
-- else keyed by a user id: go-authkit owns that table and deletes accounts with
-- a bare DELETE that an FK would abort. Deleting an account therefore takes the
-- feedback with it, which is also the answer someone asking to be forgotten
-- expects.
CREATE TABLE IF NOT EXISTS feedback (
    id          TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    -- Denormalised so a listing needs no join across a table this package does
    -- not own.
    username    TEXT NOT NULL DEFAULT '',
    category    TEXT NOT NULL DEFAULT 'other',
    message     TEXT NOT NULL,
    diagnostics TEXT,
    resolved_at TIMESTAMP,
    created_at  TIMESTAMP NOT NULL
);

-- The admin list is "newest first, unresolved first"; this covers the ordering.
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at DESC);
