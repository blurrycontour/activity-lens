-- How many cadence samples a workout recorded, so a list can be filtered by
-- whether it has any.
--
-- A column rather than a test on the stored series: the timelines are gzipped
-- JSON, so SQL cannot tell an empty one from a full one — LENGTH() sees the
-- compressed bytes, and gzip of "[]" is a couple of dozen of them. The first
-- attempt did exactly that and reported every workout as having cadence.
--
-- -1 means "not counted yet", which is every row that existed before this
-- migration: the count can only be taken by decompressing the blob, which is
-- Go's job and not SQL's. The scheduler drains those in batches, and until it
-- does those rows simply answer "no cadence" to the filter rather than blocking
-- anything. Defaulting to 0 instead would make "not counted" and "counted, none"
-- the same state, and the backfill could never find its own work.
ALTER TABLE workouts ADD COLUMN cadence_points INTEGER NOT NULL DEFAULT -1;

CREATE INDEX IF NOT EXISTS idx_workouts_cadence_pending
  ON workouts(id) WHERE cadence_points < 0;
