-- A per-user weekly training goal ("two runs of at least 5 km a week"), used by
-- the dashboard's consistency tile. Stored server-side rather than in the
-- browser so the goal follows the user across devices.
-- Each ALTER runs separately and duplicate-column errors are tolerated by the
-- migration runner, keeping startup idempotent.
ALTER TABLE user_prefs ADD COLUMN weekly_goal_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_prefs ADD COLUMN weekly_goal_type TEXT NOT NULL DEFAULT '';
ALTER TABLE user_prefs ADD COLUMN weekly_goal_min_km REAL NOT NULL DEFAULT 0;
-- Distance at which a piece of gear should be retired, in kilometres. 0 means
-- "use the default for this equipment type".
ALTER TABLE equipment ADD COLUMN retire_at_km REAL NOT NULL DEFAULT 0;
