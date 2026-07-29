-- Archived original uploads live on disk, not in the database.
--
-- 0003 created workout_raw_uploads to hold the file bytes as a BLOB, but no
-- code ever read or wrote it: the import path has always written zstd-compressed
-- files under <data dir>/raw-uploads instead. Dropping it removes a table that
-- misleads anyone reading the schema into thinking the originals are in SQLite.
DROP TABLE IF EXISTS workout_raw_uploads;

-- The name of the file this workout was imported from, e.g. "morning_run.gpx".
-- Empty when no original was archived, which is the default: keeping them is an
-- admin setting, and it was off when most existing workouts were imported.
--
-- Recording it means "does an original exist" is answered by the row the detail
-- request already loaded, with no directory access, and that the download can
-- offer the file back under the name it arrived with rather than an internal id.
ALTER TABLE workouts ADD COLUMN raw_filename TEXT NOT NULL DEFAULT '';
