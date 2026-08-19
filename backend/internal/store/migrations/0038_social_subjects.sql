-- Comments and reactions on a workout, a training plan, or a finished session.
--
-- One pair of tables for all three kinds rather than a pair per kind, with the
-- subject held in three nullable foreign keys of which exactly one is set. The
-- alternative shapes were both worse:
--
--   six tables (workout_/plan_/session_ × comments/reactions) is three copies
--   of one store, one API and one set of handlers, kept in step by hand;
--
--   a single (subject_kind, subject_id) pair cannot carry a foreign key at
--   all, because one column cannot reference three tables — so every delete
--   path (a workout, a plan, a session, a bulk session delete, an account
--   purge) would have to remember to hand-clean orphaned threads, and the one
--   that forgot would leave rows nothing ever reads or removes.
--
-- Three real columns keep three real ON DELETE CASCADEs: deleting a plan takes
-- its conversation with it, exactly as deleting a workout always has.
--
-- The CHECK is written with CASE rather than by adding booleans so it means the
-- same thing in Postgres, where a boolean is not an integer.
--
-- Neither table has a foreign key to the users table. go-authkit owns that
-- schema and removes accounts with a bare DELETE, which a foreign key would
-- abort — the same reason workout_shares has none. Rows naming a deleted
-- account are removed by the purge, and the API drops any that outlive it
-- rather than rendering an unknown id.

CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  workout_id TEXT REFERENCES workouts(id)       ON DELETE CASCADE,
  plan_id    TEXT REFERENCES training_plans(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES plan_sessions(id)  ON DELETE CASCADE,
  user_id    INTEGER NOT NULL,
  body       TEXT    NOT NULL,
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL,
  CHECK (
    (CASE WHEN workout_id IS NULL THEN 0 ELSE 1 END)
  + (CASE WHEN plan_id    IS NULL THEN 0 ELSE 1 END)
  + (CASE WHEN session_id IS NULL THEN 0 ELSE 1 END) = 1
  )
);

-- Oldest first is the read order: a conversation is read top to bottom. One
-- index per kind, each covering only the rows that belong to it.
CREATE INDEX IF NOT EXISTS idx_comments_workout ON comments(workout_id, created_at) WHERE workout_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comments_plan    ON comments(plan_id, created_at)    WHERE plan_id    IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comments_session ON comments(session_id, created_at) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comments_user    ON comments(user_id);

CREATE TABLE IF NOT EXISTS reactions (
  workout_id TEXT REFERENCES workouts(id)       ON DELETE CASCADE,
  plan_id    TEXT REFERENCES training_plans(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES plan_sessions(id)  ON DELETE CASCADE,
  user_id    INTEGER NOT NULL,
  emoji      TEXT    NOT NULL,
  created_at TEXT    NOT NULL,
  CHECK (
    (CASE WHEN workout_id IS NULL THEN 0 ELSE 1 END)
  + (CASE WHEN plan_id    IS NULL THEN 0 ELSE 1 END)
  + (CASE WHEN session_id IS NULL THEN 0 ELSE 1 END) = 1
  )
);

-- "One reaction each" as a property of the schema rather than of the handler,
-- the same guarantee workout_reactions' primary key gave. Partial, because a
-- plain composite key over three nullable columns would let one person react
-- twice to the same plan (NULLs never compare equal in a unique index).
CREATE UNIQUE INDEX IF NOT EXISTS idx_reactions_workout_user ON reactions(workout_id, user_id) WHERE workout_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_reactions_plan_user    ON reactions(plan_id, user_id)    WHERE plan_id    IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_reactions_session_user ON reactions(session_id, user_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reactions_user ON reactions(user_id);

-- Carry the existing workout threads across. OR IGNORE on the primary key and
-- the unique indexes is what makes this safe to run on every startup: a second
-- pass inserts nothing, and a row edited since the first pass is not clobbered
-- by the copy of it that was made before the edit.
INSERT OR IGNORE INTO comments (id, workout_id, user_id, body, created_at, updated_at)
  SELECT id, workout_id, user_id, body, created_at, updated_at FROM workout_comments;

INSERT OR IGNORE INTO reactions (workout_id, user_id, emoji, created_at)
  SELECT workout_id, user_id, emoji, created_at FROM workout_reactions;
