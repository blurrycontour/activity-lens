-- Comments and reactions on a shared workout.
--
-- Both are gated on the workout being shared, and that gate lives in the API
-- layer rather than here: "shared" means public OR at least one direct share
-- row, which is a predicate over two other tables and would have to be
-- duplicated into every statement below to be enforced in SQL. Unsharing hides
-- these rows; it does not delete them, so re-sharing brings the conversation
-- back rather than starting a new one.
--
-- Neither table has a foreign key to the users table. go-authkit owns that
-- schema and removes accounts with a bare DELETE, which a foreign key would
-- abort — the same reason workout_shares has none. Rows naming a deleted
-- account are removed by the purge, and the API drops any that outlive it
-- rather than rendering an unknown id.

CREATE TABLE IF NOT EXISTS workout_comments (
  id         TEXT PRIMARY KEY,
  workout_id TEXT    NOT NULL,
  user_id    INTEGER NOT NULL,
  body       TEXT    NOT NULL,
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL,
  FOREIGN KEY (workout_id) REFERENCES workouts(id) ON DELETE CASCADE
);

-- Oldest first is the read order: a conversation is read top to bottom.
CREATE INDEX IF NOT EXISTS idx_workout_comments_workout
  ON workout_comments(workout_id, created_at);

-- One reaction per person per workout, enforced by the primary key rather than
-- by the handler: picking a second emoji replaces the first, which is an UPSERT
-- on exactly this key.
CREATE TABLE IF NOT EXISTS workout_reactions (
  workout_id TEXT    NOT NULL,
  user_id    INTEGER NOT NULL,
  emoji      TEXT    NOT NULL,
  created_at TEXT    NOT NULL,
  PRIMARY KEY (workout_id, user_id),
  FOREIGN KEY (workout_id) REFERENCES workouts(id) ON DELETE CASCADE
);
