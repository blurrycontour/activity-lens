-- Add a per-workout step count. Steps are estimated from distance and activity
-- type at import time but can be manually overridden by the user.
ALTER TABLE workouts ADD COLUMN steps INTEGER NOT NULL DEFAULT 0;
