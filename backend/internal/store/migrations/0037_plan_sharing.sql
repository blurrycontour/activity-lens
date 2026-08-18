-- Sharing for training plans and their sessions, mirroring workout_shares
-- (0015_workout_sharing.sql) with one table per parent rather than a single
-- polymorphic one: a real cascading foreign key per table means a deleted
-- plan or session takes its share rows with it automatically, the same
-- guarantee workout_shares already has. A single (kind, item_id, user_id)
-- table could not express that FK against two different parent tables, and
-- would need every delete path to remember to clean up by hand instead.
ALTER TABLE training_plans ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';
ALTER TABLE plan_sessions  ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';

CREATE TABLE IF NOT EXISTS plan_shares (
    plan_id    TEXT NOT NULL,
    user_id    INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (plan_id, user_id),
    FOREIGN KEY (plan_id) REFERENCES training_plans(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_plan_shares_user ON plan_shares(user_id);

CREATE TABLE IF NOT EXISTS plan_session_shares (
    session_id TEXT NOT NULL,
    user_id    INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (session_id, user_id),
    FOREIGN KEY (session_id) REFERENCES plan_sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_plan_session_shares_user ON plan_session_shares(user_id);

-- Partial indexes for the public feeds. A session additionally needs to be
-- finished to ever be public — see plans.Service.SetSessionVisibility — so
-- that restriction is baked into the index too, not just the check above it.
CREATE INDEX IF NOT EXISTS idx_training_plans_public ON training_plans(updated_at DESC)
  WHERE visibility = 'public';
CREATE INDEX IF NOT EXISTS idx_plan_sessions_public ON plan_sessions(started_at DESC)
  WHERE visibility = 'public' AND finished_at IS NOT NULL;
