-- Cadence samples (steps/min for foot activities, rpm for rides) recorded by
-- TCX/GPX sources, stored gzip-compressed like the other timelines, plus a flag
-- marking calories the source file reported outright so the UI does not badge
-- them as computed. Each ALTER runs separately and duplicate-column errors are
-- tolerated by the migration runner, keeping startup idempotent.
ALTER TABLE workouts ADD COLUMN cadence_timeline BLOB;
ALTER TABLE workouts ADD COLUMN calories_reported INTEGER NOT NULL DEFAULT 0;
