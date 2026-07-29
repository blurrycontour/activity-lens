-- Sharing. A workout is private by default, may be made visible to every
-- signed-in user of this instance ('public'), and may independently be shared
-- with named users through workout_shares. The two mechanisms are orthogonal:
-- turning visibility back to 'private' does not revoke direct shares.
--
-- workout_shares deliberately carries NO foreign key to users. go-authkit owns
-- that table and removes accounts with a bare DELETE; with foreign_keys=ON an
-- FK here would make user deletion fail. Share rows naming a user who no longer
-- exists are dropped when recipients are resolved through the user directory.
ALTER TABLE workouts ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';

CREATE TABLE IF NOT EXISTS workout_shares (
    workout_id TEXT    NOT NULL,
    user_id    INTEGER NOT NULL,
    created_at TEXT    NOT NULL,
    PRIMARY KEY (workout_id, user_id),
    FOREIGN KEY (workout_id) REFERENCES workouts(id) ON DELETE CASCADE
);

-- "Workouts shared with me."
CREATE INDEX IF NOT EXISTS idx_workout_shares_user ON workout_shares(user_id);

-- The public feed scans public rows only, so a partial index keeps it
-- proportional to the number of shared workouts rather than the whole table.
-- Partial indexes work on both SQLite and Postgres (see 0014 for the same
-- technique).
CREATE INDEX IF NOT EXISTS idx_workouts_public_start
    ON workouts (start_time DESC)
    WHERE visibility = 'public';
