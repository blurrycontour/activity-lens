-- A simplified copy of each route, plus its bounding box, for the map that
-- shows every workout at once.
--
-- Denormalised rather than derived on demand: the full route lives in a gzipped
-- blob that SQL cannot read, so filtering "which workouts are visible here"
-- would otherwise mean decompressing the entire library on every pan.
--
-- Every column defaults to zero, which is also a legitimate coordinate off the
-- coast of Africa — track_points is what distinguishes "no simplified route
-- yet" from "a route that happens to pass through the Gulf of Guinea", and it
-- is the only thing that should ever be tested for that.
ALTER TABLE workouts ADD COLUMN track BLOB;
ALTER TABLE workouts ADD COLUMN track_points INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workouts ADD COLUMN bbox_min_lat REAL NOT NULL DEFAULT 0;
ALTER TABLE workouts ADD COLUMN bbox_max_lat REAL NOT NULL DEFAULT 0;
ALTER TABLE workouts ADD COLUMN bbox_min_lon REAL NOT NULL DEFAULT 0;
ALTER TABLE workouts ADD COLUMN bbox_max_lon REAL NOT NULL DEFAULT 0;

-- The map's query is "this user's workouts, in this time range, overlapping
-- this box". User and time come first because they are the selective part; the
-- box is checked against whatever that leaves.
CREATE INDEX IF NOT EXISTS idx_workouts_track
  ON workouts(user_id, start_time)
  WHERE track_points > 0;

-- Rows still owed a simplified route. Empties itself as the backfill drains,
-- exactly like the weather index in 0022.
CREATE INDEX IF NOT EXISTS idx_workouts_track_pending
  ON workouts(user_id)
  WHERE track_points = 0;
