-- Stretches of a workout during which nothing was recorded, and the elapsed
-- time with those removed.
--
-- Stored rather than derived on read for the same reason as the simplified
-- track: the sample series live in gzipped blobs, so working this out on demand
-- would mean decompressing every timeline of every workout on every list. It is
-- also what the averages are computed from, and those are columns.
--
-- moving_time defaults to 0, which is not a possible answer for a real workout
-- and is therefore the marker for "never worked out" — every row imported
-- before this existed, until it is recalculated. Readers treat a zero as
-- "use duration". The pauses blob cannot carry that distinction on its own: a
-- workout that genuinely never paused has an empty list too.
ALTER TABLE workouts ADD COLUMN pauses BLOB;
ALTER TABLE workouts ADD COLUMN moving_time INTEGER NOT NULL DEFAULT 0;
