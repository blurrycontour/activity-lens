-- Backfill heart-rate / performance columns on user_prefs for databases that
-- were created before these columns were added to the initial table
-- definition. Each ALTER runs separately and duplicate-column errors are
-- tolerated by the migration runner, keeping startup idempotent.
ALTER TABLE user_prefs ADD COLUMN max_hr INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_prefs ADD COLUMN resting_hr INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_prefs ADD COLUMN threshold_pace TEXT NOT NULL DEFAULT '';
ALTER TABLE user_prefs ADD COLUMN ftp INTEGER NOT NULL DEFAULT 0;
